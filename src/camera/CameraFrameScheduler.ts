export type CameraFrameSchedulerMode =
    | "video-frame"
    | "animation-frame";

export type CameraFrameListener = (
    nowMs: number,
) => void;

export class CameraFrameScheduler {
    private readonly videoElement: HTMLVideoElement;
    private readonly mode: CameraFrameSchedulerMode;

    private listener: CameraFrameListener | null = null;
    private videoFrameRequestId: number | null = null;
    private animationFrameRequestId: number | null = null;
    private running = false;

    public constructor(videoElement: HTMLVideoElement) {
        this.videoElement = videoElement;

        this.mode =
            typeof videoElement.requestVideoFrameCallback ===
                "function"
                ? "video-frame"
                : "animation-frame";
    }

    public start(listener: CameraFrameListener): void {
        this.listener = listener;

        if (this.running) {
            return;
        }

        this.running = true;
        this.scheduleNextFrame();
    }

    public stop(): void {
        this.running = false;
        this.listener = null;

        if (this.videoFrameRequestId !== null) {
            this.videoElement.cancelVideoFrameCallback(
                this.videoFrameRequestId,
            );

            this.videoFrameRequestId = null;
        }

        if (this.animationFrameRequestId !== null) {
            cancelAnimationFrame(
                this.animationFrameRequestId,
            );

            this.animationFrameRequestId = null;
        }
    }

    public getMode(): CameraFrameSchedulerMode {
        return this.mode;
    }

    private scheduleNextFrame(): void {
        if (!this.running) {
            return;
        }

        if (this.mode === "video-frame") {
            this.videoFrameRequestId =
                this.videoElement.requestVideoFrameCallback(
                    this.handleVideoFrame,
                );

            return;
        }

        this.animationFrameRequestId =
            requestAnimationFrame(
                this.handleAnimationFrame,
            );
    }

    private readonly handleVideoFrame = (
        nowMs: number,
    ): void => {
        this.videoFrameRequestId = null;
        this.notifyAndContinue(nowMs);
    };

    private readonly handleAnimationFrame = (
        nowMs: number,
    ): void => {
        this.animationFrameRequestId = null;
        this.notifyAndContinue(nowMs);
    };

    private notifyAndContinue(nowMs: number): void {
        if (!this.running) {
            return;
        }

        this.listener?.(nowMs);
        this.scheduleNextFrame();
    }
}
