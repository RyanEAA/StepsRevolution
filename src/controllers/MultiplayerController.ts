import type { AppView } from "../app/AppView";
import { CHART_IDENTITY_VERSION } from "../../shared/constants";
import type {
    Availability,
    RoomSelection,
} from "../../shared/schemas";
import type { LocalChartAvailability } from "../library/ChartAvailabilityIndex";
import type {
    ProposedRoomSelection,
    RoomSessionState,
} from "../multiplayer/RoomSession";
import type { GameplaySession } from "../session/GameplaySession";
import type { StepManiaChart } from "../types/Chart";
import type { SongEntry } from "../types/Library";
import type { MultiplayerViewCallbacks } from "../ui/MultiplayerView";

export interface MultiplayerRoomSessionPort extends GameplaySession {
    getState(): Readonly<RoomSessionState>;
    subscribe(listener: (state: Readonly<RoomSessionState>) => void): () => void;
    createRoom(displayName: string): Promise<unknown>;
    joinRoom(roomCode: string, displayName: string): Promise<unknown>;
    leaveRoom(): Promise<void>;
    disconnect(): void;
    setSelection(selection: ProposedRoomSelection): Promise<void>;
    reportAvailability(availability: Availability): Promise<void>;
    setReady(ready: boolean): Promise<void>;
    beginReadyCheck(): Promise<void>;
    cancelReadyCheck(): Promise<void>;
    kickPlayer(playerId: string): Promise<void>;
}

export interface MultiplayerSessionManagerPort {
    getActiveSession(): GameplaySession;
    useLocalSession(): void;
    useOnlineSession(session: GameplaySession): void;
}

export interface MultiplayerViewManagerPort {
    show(view: AppView): void;
}

export interface MultiplayerViewPort {
    initialize(callbacks: MultiplayerViewCallbacks): void;
    destroy(): void;
    showHostForm(): void;
    showJoinForm(): void;
    hideForms(): void;
    setPending(pending: boolean, message?: string): void;
    setStatus(message: string): void;
    setSelectionStatus(message: string): void;
    setReadyStatus(message: string): void;
    renderSession(state: Readonly<RoomSessionState>): void;
}

export interface MultiplayerControllerOptions {
    roomSession: MultiplayerRoomSessionPort;
    sessionManager: MultiplayerSessionManagerPort;
    viewManager: MultiplayerViewManagerPort;
    view: MultiplayerViewPort;
    getSinglePlayerDestination: () =>
        "library-import" | "pack-selection";
    setRoomSelectionMode: (enabled: boolean) => void;
    checkAvailability: (selection: RoomSelection) => LocalChartAvailability;
    selectDifficulty?: (chartId: string) => Promise<void>;
    retrySongPreparation?: () => void;
    requestCountdown?: () => Promise<void>;
    unlockOnlineAudio?: () => Promise<void>;
}

export class MultiplayerController {
    private readonly roomSession: MultiplayerRoomSessionPort;
    private readonly sessionManager: MultiplayerSessionManagerPort;
    private readonly viewManager: MultiplayerViewManagerPort;
    private readonly view: MultiplayerViewPort;
    private readonly getSinglePlayerDestination:
        MultiplayerControllerOptions["getSinglePlayerDestination"];
    private readonly setRoomSelectionMode:
        MultiplayerControllerOptions["setRoomSelectionMode"];
    private readonly checkAvailability:
        MultiplayerControllerOptions["checkAvailability"];
    private readonly selectDifficulty: (chartId: string) => Promise<void>;
    private readonly retrySongPreparation: () => void;
    private readonly requestCountdown: () => Promise<void>;
    private readonly unlockOnlineAudio: () => Promise<void>;
    private unsubscribeSession: (() => void) | null = null;
    private pending = false;
    private hasJoinedRoom = false;
    private selectionTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingSelection: ProposedRoomSelection | null = null;
    private selectionGeneration = 0;
    private availabilityInFlightRevision: number | null = null;
    private availabilityRetryTimer: ReturnType<typeof setTimeout> | null = null;

    public constructor(options: MultiplayerControllerOptions) {
        this.roomSession = options.roomSession;
        this.sessionManager = options.sessionManager;
        this.viewManager = options.viewManager;
        this.view = options.view;
        this.getSinglePlayerDestination =
            options.getSinglePlayerDestination;
        this.setRoomSelectionMode = options.setRoomSelectionMode;
        this.checkAvailability = options.checkAvailability;
        this.selectDifficulty = options.selectDifficulty ?? (async () => undefined);
        this.retrySongPreparation = options.retrySongPreparation ?? (() => undefined);
        this.requestCountdown = options.requestCountdown ?? (async () => undefined);
        this.unlockOnlineAudio = options.unlockOnlineAudio ?? (async () => undefined);
    }

    public initialize(): void {
        this.view.initialize({
            onSinglePlayer: this.startSinglePlayer,
            onHostSelected: () => this.view.showHostForm(),
            onJoinSelected: () => this.view.showJoinForm(),
            onHostSubmitted: (displayName) => {
                void this.host(displayName);
            },
            onJoinSubmitted: (roomCode, displayName) => {
                void this.join(roomCode, displayName);
            },
            onCancelForm: () => this.view.hideForms(),
            onLeaveRoom: () => {
                void this.leaveRoom();
            },
            onKickPlayer: (playerId) => {
                void this.runReadyAction(() => this.roomSession.kickPlayer(playerId));
            },
            onSessionNavigation: this.showSession,
            onBrowseHostLibrary: this.browseHostLibrary,
            onImportLocalLibrary: this.importLocalLibrary,
            onBeginReadyCheck: () => {
                void this.runReadyAction(() =>
                    this.roomSession.beginReadyCheck());
            },
            onCancelReadyCheck: () => {
                void this.runReadyAction(() =>
                    this.roomSession.cancelReadyCheck());
            },
            onSetReady: (ready) => {
                void this.runReadyAction(async () => {
                    if (ready) await this.unlockOnlineAudio();
                    await this.roomSession.setReady(ready);
                });
            },
            onDifficultySelected: (chartId) => {
                void this.runReadyAction(() => this.selectDifficulty(chartId));
            },
            onRetrySongPreparation: () => this.retrySongPreparation(),
            onStartCountdown: () => {
                void this.runReadyAction(() => this.requestCountdown());
            },
        });
        this.unsubscribeSession =
            this.roomSession.subscribe(this.handleSessionState);
    }

    public destroy(): void {
        this.unsubscribeSession?.();
        this.unsubscribeSession = null;
        if (this.selectionTimer) clearTimeout(this.selectionTimer);
        if (this.availabilityRetryTimer) {
            clearTimeout(this.availabilityRetryTimer);
        }
        this.view.destroy();
    }

    public handleLibraryChanged(): void {
        void this.synchronizeAvailability();
    }

    public selectChartForRoom(
        song: SongEntry,
        chart: StepManiaChart,
    ): void {
        const room = this.roomSession.getState().room;
        const localPlayerId = this.roomSession.getState().localPlayerId;
        if (!room || room.hostPlayerId !== localPlayerId) {
            this.view.setSelectionStatus(
                "Only the room host can select a chart.",
            );
            return;
        }

        const chartIndex = song.simfile.charts.indexOf(chart);
        const identity = song.chartIdentities.find(
            (record) => record.chartIndex === chartIndex,
        );
        if (!identity || identity.state !== "available") {
            this.view.setSelectionStatus(
                "This chart identity is not available. Reimport the song library and try again.",
            );
            this.viewManager.show("multiplayer-lobby");
            return;
        }

        this.pendingSelection = {
            songId: identity.songId,
            chartId: identity.chartId,
            chartHash: identity.chartHash,
            identityVersion: CHART_IDENTITY_VERSION,
            title: song.title,
            subtitle: song.simfile.subtitle,
            artist: song.artist,
            stepType: "dance-single",
            difficulty: chart.difficulty,
            meter: chart.meter,
            tapCount: identity.tapCount,
            durationSeconds: identity.durationSeconds,
        };
        this.selectionGeneration += 1;
        if (this.selectionTimer) clearTimeout(this.selectionTimer);
        this.view.setSelectionStatus("Publishing room selection…");
        this.viewManager.show("multiplayer-lobby");
        this.selectionTimer = setTimeout(() => {
            this.selectionTimer = null;
            void this.publishPendingSelection(this.selectionGeneration);
        }, 250);
    }

    private readonly startSinglePlayer = (): void => {
        if (this.pending) return;
        this.sessionManager.useLocalSession();
        this.setRoomSelectionMode(false);
        this.view.hideForms();
        this.viewManager.show(this.getSinglePlayerDestination());
    };

    private readonly showSession = (): void => {
        if (this.sessionManager.getActiveSession().kind === "online" &&
            this.roomSession.getState().room) {
            this.viewManager.show("multiplayer-lobby");
            return;
        }
        this.viewManager.show("mode-selection");
    };

    private readonly browseHostLibrary = (): void => {
        const state = this.roomSession.getState();
        if (!state.room || state.localPlayerId !== state.room.hostPlayerId) {
            this.view.setSelectionStatus(
                "Only the host can choose the room song.",
            );
            return;
        }
        this.setRoomSelectionMode(true);
        this.viewManager.show(this.getSinglePlayerDestination());
    };

    private readonly importLocalLibrary = (): void => {
        this.setRoomSelectionMode(false);
        this.viewManager.show("library-import");
    };

    private async host(displayName: string): Promise<void> {
        if (!displayName) {
            this.view.setStatus("Enter a display name.");
            return;
        }
        await this.runRoomAction(
            "Creating room…",
            () => this.roomSession.createRoom(displayName),
        );
    }

    private async join(
        roomCode: string,
        displayName: string,
    ): Promise<void> {
        if (!displayName || roomCode.length !== 6) {
            this.view.setStatus(
                "Enter a display name and a six-character room code.",
            );
            return;
        }
        await this.runRoomAction(
            "Joining room…",
            () => this.roomSession.joinRoom(
                roomCode.trim().toUpperCase(),
                displayName,
            ),
        );
    }

    private async runRoomAction(
        pendingMessage: string,
        action: () => Promise<unknown>,
    ): Promise<void> {
        if (this.pending) return;
        this.pending = true;
        this.view.setPending(true, pendingMessage);
        try {
            await action();
            this.hasJoinedRoom = true;
            this.sessionManager.useOnlineSession(this.roomSession);
            this.setRoomSelectionMode(false);
            this.view.hideForms();
            this.viewManager.show("multiplayer-lobby");
        } catch (error) {
            this.view.setStatus(
                error instanceof Error
                    ? error.message
                    : "The room request failed.",
            );
        } finally {
            this.pending = false;
            this.view.setPending(false);
        }
    }

    private async leaveRoom(): Promise<void> {
        if (this.pending) return;
        this.pending = true;
        this.view.setPending(true, "Leaving room…");
        try {
            await this.roomSession.leaveRoom();
            this.roomSession.disconnect();
            this.hasJoinedRoom = false;
            this.sessionManager.useLocalSession();
            this.setRoomSelectionMode(false);
            this.view.hideForms();
            this.viewManager.show("mode-selection");
        } catch (error) {
            this.view.setStatus(
                error instanceof Error
                    ? error.message
                    : "Could not leave the room.",
            );
        } finally {
            this.pending = false;
            this.view.setPending(false);
        }
    }

    private async publishPendingSelection(
        generation: number,
    ): Promise<void> {
        const selection = this.pendingSelection;
        if (!selection) return;
        try {
            await this.roomSession.setSelection(selection);
            if (generation === this.selectionGeneration) {
                this.pendingSelection = null;
                this.view.setSelectionStatus(
                    "Waiting for the canonical room update…",
                );
            }
        } catch (error) {
            if (generation === this.selectionGeneration) {
                this.view.setSelectionStatus(
                    error instanceof Error
                        ? error.message
                        : "Could not publish the room selection.",
                );
            }
        }
    }

    private async synchronizeAvailability(): Promise<void> {
        const state = this.roomSession.getState();
        const selection = state.room?.selection;
        if (state.room?.songPackage) return;
        const localPlayer = state.room?.players.find(
            (player) => player.playerId === state.localPlayerId,
        );
        if (!selection || !localPlayer ||
            state.connectionState !== "connected") {
            return;
        }

        const local = this.checkAvailability(selection);
        const availability: Availability = {
            status: local.status,
            selectionRevision: local.selectionRevision,
            chartHash: local.chartHash,
            audioReady: local.audioReady,
        };
        if (this.availabilityMatches(
            localPlayer.availability,
            availability,
        ) || this.availabilityInFlightRevision === selection.selectionRevision) {
            return;
        }

        this.availabilityInFlightRevision = selection.selectionRevision;
        this.view.setSelectionStatus("Checking local chart availability…");
        let shouldRetry = false;
        try {
            await this.roomSession.reportAvailability(availability);
        } catch (error) {
            shouldRetry = this.isStaleRevisionError(error);
            if (!shouldRetry) {
                this.view.setSelectionStatus(
                    error instanceof Error
                        ? error.message
                        : "Could not report local chart availability.",
                );
            }
        } finally {
            if (this.availabilityInFlightRevision ===
                selection.selectionRevision) {
                this.availabilityInFlightRevision = null;
            }
        }

        if (shouldRetry) {
            this.scheduleAvailabilityRetry();
        }
    }

    private async runReadyAction(
        action: () => Promise<void>,
    ): Promise<void> {
        try {
            await action();
        } catch (error) {
            if (this.isStaleRevisionError(error)) {
                await new Promise((resolve) => setTimeout(resolve, 75));
                try {
                    await action();
                    return;
                } catch (retryError) {
                    error = retryError;
                }
            }
            this.view.setReadyStatus(
                error instanceof Error
                    ? error.message
                    : "The readiness update failed.",
            );
        }
    }

    private availabilityMatches(
        current: Availability,
        expected: Availability,
    ): boolean {
        return current.status === expected.status &&
            current.selectionRevision === expected.selectionRevision &&
            current.chartHash === expected.chartHash &&
            current.audioReady === expected.audioReady;
    }

    private isStaleRevisionError(error: unknown): boolean {
        return typeof error === "object" && error !== null &&
            "code" in error &&
            error.code === "stale-room-revision";
    }

    private scheduleAvailabilityRetry(): void {
        if (this.availabilityRetryTimer) {
            clearTimeout(this.availabilityRetryTimer);
        }
        this.availabilityRetryTimer = setTimeout(() => {
            this.availabilityRetryTimer = null;
            void this.synchronizeAvailability();
        }, 50);
    }

    private readonly handleSessionState = (
        state: Readonly<RoomSessionState>,
    ): void => {
        this.view.renderSession(state);
        void this.synchronizeAvailability();
        if (this.hasJoinedRoom && !state.room && !this.pending) {
            this.hasJoinedRoom = false;
            this.sessionManager.useLocalSession();
            this.setRoomSelectionMode(false);
            this.viewManager.show("mode-selection");
            if (state.lastError) this.view.setStatus(state.lastError);
        }
    };
}
