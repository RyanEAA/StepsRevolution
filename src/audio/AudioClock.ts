export type AudioClockStatus =
    | "empty"
    | "ready"
    | "playing"
    | "paused"
    | "finished";

export class AudioClock {
    private audioContext: AudioContext | null = null;
    private audioBuffer: AudioBuffer | null = null;
    private sourceNode: AudioBufferSourceNode | null = null;

    private status: AudioClockStatus = "empty";

    /**
     * AudioContext.currentTime when the current source began playing.
     */
    private contextStartTimeSeconds = 0;

    /**
     * Position in the song where the current source began.
     */
    private sourceOffsetSeconds = 0;

    /**
     * Stored position while paused.
     */
    private pausedAtSeconds = 0;

    public async loadFile(file: File): Promise<void> {
        this.stopSource();

        const context = this.getOrCreateAudioContext();
        const fileData = await file.arrayBuffer();

        try {
            this.audioBuffer = await context.decodeAudioData(fileData);
        } catch (error) {
            this.audioBuffer = null;
            this.status = "empty";

            throw new Error(
                `Could not decode "${file.name}". The file may be unsupported or damaged.`,
                { cause: error },
            );
        }

        this.sourceOffsetSeconds = 0;
        this.pausedAtSeconds = 0;
        this.status = "ready";
    }

    public async playFromStart(): Promise<void> {
        this.ensureAudioLoaded();

        await this.ensureContextRunning();

        this.stopSource();

        this.sourceOffsetSeconds = 0;
        this.pausedAtSeconds = 0;

        this.startSourceAt(0);
    }

    public async unlock(): Promise<void> {
        await this.ensureContextRunning();
    }

    public async scheduleFromStart(localPerformanceTimeMs: number): Promise<void> {
        this.ensureAudioLoaded();
        await this.ensureContextRunning();
        const delaySeconds = (localPerformanceTimeMs - performance.now()) / 1000;
        if (delaySeconds < 0.2) throw new Error("The synchronized start arrived too late to schedule safely.");
        this.stopSource();
        this.sourceOffsetSeconds = 0;
        this.pausedAtSeconds = 0;
        const context = this.getOrCreateAudioContext();
        this.startSourceAt(0, context.currentTime + delaySeconds);
    }

    public async pause(): Promise<void> {
        if (this.status !== "playing") {
            return;
        }

        this.pausedAtSeconds = this.getCurrentTimeSeconds();
        this.sourceOffsetSeconds = this.pausedAtSeconds;

        this.stopSource();
        this.status = "paused";
    }

    public async resume(): Promise<void> {
        if (this.status !== "paused") {
            return;
        }

        this.ensureAudioLoaded();
        await this.ensureContextRunning();

        if (this.pausedAtSeconds >= this.getDurationSeconds()) {
            this.status = "finished";
            return;
        }

        this.startSourceAt(this.pausedAtSeconds);
    }

    public async restart(): Promise<void> {
        await this.playFromStart();
    }

    public stop(): void {
        this.stopSource();

        this.sourceOffsetSeconds = 0;
        this.pausedAtSeconds = 0;

        this.status = this.audioBuffer
            ? "ready"
            : "empty";
    }

    public clear(): void {
        this.stopSource();
        this.audioBuffer = null;
        this.sourceOffsetSeconds = 0;
        this.pausedAtSeconds = 0;
        this.status = "empty";
    }

    public getCurrentTimeSeconds(): number {
        this.reconcileNaturalEnd();

        if (
            this.status === "playing" &&
            this.audioContext
        ) {
            const elapsedContextTime =
                this.audioContext.currentTime -
                this.contextStartTimeSeconds;

            return Math.max(0, Math.min(
                this.sourceOffsetSeconds + elapsedContextTime,
                this.getDurationSeconds(),
            ));
        }

        return this.pausedAtSeconds;
    }

    public getDurationSeconds(): number {
        return this.audioBuffer?.duration ?? 0;
    }

    public getStatus(): AudioClockStatus {
        this.reconcileNaturalEnd();
        return this.status;
    }

    public hasAudio(): boolean {
        return this.audioBuffer !== null;
    }

    public destroy(): void {
        this.stopSource();

        if (this.audioContext) {
            void this.audioContext.close();
        }

        this.audioContext = null;
        this.audioBuffer = null;
        this.status = "empty";
    }

    private startSourceAt(offsetSeconds: number, startAtContextSeconds?: number): void {
        const context = this.getOrCreateAudioContext();
        const buffer = this.audioBuffer;

        if (!buffer) {
            throw new Error("No audio file has been loaded.");
        }

        const safeOffset = this.clamp(
            offsetSeconds,
            0,
            buffer.duration,
        );

        const source = context.createBufferSource();

        source.buffer = buffer;
        source.connect(context.destination);

        source.addEventListener(
            "ended",
            this.handleSourceEnded,
            { once: true },
        );

        this.sourceNode = source;
        this.sourceOffsetSeconds = safeOffset;
        const scheduledStart = startAtContextSeconds ?? context.currentTime;
        this.contextStartTimeSeconds = scheduledStart;

        source.start(
            scheduledStart,
            safeOffset,
        );

        this.status = "playing";
    }

    private stopSource(): void {
        if (!this.sourceNode) {
            return;
        }

        this.sourceNode.removeEventListener(
            "ended",
            this.handleSourceEnded,
        );

        try {
            this.sourceNode.stop();
        } catch {
            /*
             * A source may already have ended or been stopped.
             */
        }

        this.sourceNode.disconnect();
        this.sourceNode = null;
    }

    private readonly handleSourceEnded = (): void => {
        this.markNaturallyFinished();
    };

    private reconcileNaturalEnd(): void {
        if (
            this.status !== "playing" ||
            !this.audioContext ||
            !this.audioBuffer
        ) {
            return;
        }

        const playbackPositionSeconds =
            this.sourceOffsetSeconds +
            (this.audioContext.currentTime - this.contextStartTimeSeconds);

        /*
         * AudioBufferSourceNode's ended event can be delayed or missed by a
         * browser after a scheduled start. The Web Audio clock is still
         * authoritative, so reaching the decoded buffer duration is an
         * equivalent and deterministic completion signal.
         */
        if (playbackPositionSeconds >= this.audioBuffer.duration) {
            this.markNaturallyFinished();
        }
    }

    private markNaturallyFinished(): void {
        const source = this.sourceNode;
        if (source) {
            source.removeEventListener("ended", this.handleSourceEnded);
            try {
                source.disconnect();
            } catch {
                // An already-ended source may already be disconnected.
            }
        }

        this.sourceNode = null;
        this.pausedAtSeconds = this.getDurationSeconds();
        this.sourceOffsetSeconds = this.pausedAtSeconds;
        this.status = "finished";
    }

    private getOrCreateAudioContext(): AudioContext {
        if (!this.audioContext) {
            this.audioContext = new AudioContext();
        }

        return this.audioContext;
    }

    private async ensureContextRunning(): Promise<void> {
        const context = this.getOrCreateAudioContext();

        if (context.state === "suspended") {
            await context.resume();
        }

        if (context.state !== "running") {
            throw new Error(
                `Audio context could not start. Current state: ${context.state}`,
            );
        }
    }

    private ensureAudioLoaded(): void {
        if (!this.audioBuffer) {
            throw new Error(
                "Load an audio file before starting the game.",
            );
        }
    }

    private clamp(
        value: number,
        minimum: number,
        maximum: number,
    ): number {
        return Math.min(
            Math.max(value, minimum),
            maximum,
        );
    }
}
