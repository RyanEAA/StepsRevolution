import type { RoomSession, RoomSessionState } from "../multiplayer/RoomSession";
import { ClockSynchronizer } from "../multiplayer/ClockSynchronizer";

export interface ScheduledGameplayPort {
    scheduleOnlineStart(localPerformanceTimeMs: number): Promise<void>;
    cancelOnlineStart(returnToLobby?: boolean): void;
}

export class MultiplayerStartController {
    private readonly session: RoomSession;
    private readonly gameplay: ScheduledGameplayPort;
    private readonly setStatus: (message: string) => void;
    private readonly clock = new ClockSynchronizer();
    private unsubscribe: (() => void) | null = null;
    private sampleTimer: ReturnType<typeof setInterval> | null = null;
    private synchronizing = false;
    private scheduledKey: string | null = null;
    private lastPhase: string | null = null;

    public constructor(
        session: RoomSession,
        gameplay: ScheduledGameplayPort,
        setStatus: (message: string) => void,
    ) {
        this.session = session;
        this.gameplay = gameplay;
        this.setStatus = setStatus;
    }

    public initialize(): void {
        this.unsubscribe = this.session.subscribe((state) => this.handleState(state));
        this.sampleTimer = setInterval(() => void this.synchronize(), 15_000);
    }

    public async synchronize(): Promise<void> {
        const state = this.session.getState();
        if (this.synchronizing || !state.room || state.connectionState !== "connected" ||
            (state.room.phase !== "selecting" && state.room.phase !== "ready-check")) return;
        this.synchronizing = true;
        try {
            const samples = [];
            for (let index = 0; index < 5; index += 1) {
                const sent = performance.now();
                const pong = await this.session.pingClock(sent);
                samples.push({
                    clientSentMs: sent,
                    serverReceivedMs: pong.serverReceivedAtMs,
                    serverSentMs: pong.serverSentAtMs,
                    clientReceivedMs: performance.now(),
                });
            }
            const estimate = this.clock.acceptSamples(samples);
            await this.retryRevisioned(() => this.session.reportClockQuality(estimate.usable));
            this.setStatus(estimate.usable
                ? `Clock synchronized · ${Math.round(estimate.roundTripMs)} ms round trip`
                : "Network latency is too high for a synchronized start.");
        } catch (error) {
            this.setStatus(error instanceof Error ? error.message : "Clock synchronization failed.");
            await this.retryRevisioned(() => this.session.reportClockQuality(false)).catch(() => undefined);
        } finally {
            this.synchronizing = false;
        }
    }

    public destroy(): void {
        this.unsubscribe?.();
        if (this.sampleTimer) clearInterval(this.sampleTimer);
        this.gameplay.cancelOnlineStart(false);
    }

    private handleState(state: Readonly<RoomSessionState>): void {
        const phase = state.room?.phase ?? null;
        const leftResults = this.lastPhase === "results" &&
            (phase === "selecting" || phase === "ready-check");
        this.lastPhase = phase;
        if (leftResults) this.gameplay.cancelOnlineStart(true);
        const schedule = state.room?.startSchedule;
        if (state.room && (state.room.phase === "selecting" || state.room.phase === "ready-check") &&
            !this.clock.isUsable()) void this.synchronize();
        if (state.room?.phase === "countdown" && schedule) {
            const key = `${schedule.selectionRevision}:${schedule.startAtServerMs}`;
            if (this.scheduledKey !== key) {
                this.scheduledKey = key;
                void this.schedule(schedule.startAtServerMs);
            }
            return;
        }
        if (this.scheduledKey && state.room?.phase === "results") {
            this.scheduledKey = null;
            return;
        }
        if (this.scheduledKey && state.room?.phase !== "playing") {
            this.scheduledKey = null;
            this.gameplay.cancelOnlineStart();
        }
    }

    private async schedule(serverStartMs: number): Promise<void> {
        try {
            if (!this.clock.isUsable()) throw new Error("Clock synchronization expired before countdown.");
            const localStart = this.clock.serverToPerformanceTime(serverStartMs);
            await this.gameplay.scheduleOnlineStart(localStart);
            await this.retryRevisioned(() => this.session.confirmCountdownScheduled());
            this.setStatus("Synchronized start scheduled.");
        } catch (error) {
            this.setStatus(error instanceof Error ? error.message : "Could not schedule synchronized playback.");
            await this.retryRevisioned(() => this.session.reportCountdownFailed()).catch(() => undefined);
        }
    }

    private async retryRevisioned(action: () => Promise<void>): Promise<void> {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            try { await action(); return; } catch (error) {
                if (!(typeof error === "object" && error !== null && "code" in error && error.code === "stale-room-revision") || attempt === 3) throw error;
                await new Promise((resolve) => setTimeout(resolve, 75));
            }
        }
    }
}
