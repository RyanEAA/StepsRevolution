import { PROTOCOL_VERSION } from "../../shared/constants";
import type {
    ClientCommand,
    Availability,
    FinalResult,
    LiveScore,
    RejectionCode,
    RoomState,
    RoomSelection,
    RoomPreview,
    ServerMessage,
    SessionCredentials,
} from "../../shared/schemas";
import type { PlayerAssetPreparation, PlayerChartChoice, RelayAsset, RelayAssetUploadProposal, RoomSongPackage } from "../../shared/relaySchemas";
import type {
    GameplayControlPolicy,
    GameplaySession,
} from "../session/GameplaySession";
import type {
    MultiplayerConnectionState,
    MultiplayerTransport,
} from "./MultiplayerClient";
import type { ReconnectCredentialStore } from "./ReconnectCredentialStore";

const ONLINE_CONTROL_POLICY: GameplayControlPolicy = {
    immediateStart: false,
    localPause: false,
    localRestart: false,
    localReplay: false,
};

export interface RoomSessionState {
    connectionState: MultiplayerConnectionState;
    room: RoomState | null;
    localPlayerId: string | null;
    lastError: string | null;
}

export interface RoomSessionOptions {
    client: MultiplayerTransport;
    credentialStore: ReconnectCredentialStore;
    createCommandId?: () => string;
}

export type ProposedRoomSelection = Omit<
    RoomSelection,
    "selectionRevision" | "selectedByPlayerId" | "selectedAtServerMs"
>;
export type ProposedRoomPreview = Omit<RoomPreview,
    "previewRevision" | "publishedByPlayerId" | "publishedAtServerMs">;
export type ProposedSongPackage = Omit<RoomSongPackage,
    "selectionRevision" | "selectedByPlayerId" | "selectedAtServerMs">;

export interface AssetUploadGrant {
    asset: RelayAsset;
    uploadTicket: string;
    uploadPath: string;
}

export interface AssetDownloadGrant {
    asset: RelayAsset;
    downloadTicket: string;
    downloadPath: string;
}

type RevisionedCommandPayload =
    | { availability: Availability }
    | { ready: boolean }
    | { usable: boolean }
    | { preview: ProposedRoomPreview }
    | { songPackage: ProposedSongPackage }
    | { choice: PlayerChartChoice }
    | { preparation: PlayerAssetPreparation }
    | { wantsReplay: boolean }
    | { playerId: string }
    | Record<string, never>;

export class RoomCommandRejectedError extends Error {
    public readonly code: RejectionCode;
    public readonly roomRevision: number | null;

    public constructor(
        code: RejectionCode,
        message: string,
        roomRevision: number | null,
    ) {
        super(message);
        this.name = "RoomCommandRejectedError";
        this.code = code;
        this.roomRevision = roomRevision;
    }
}

export class RoomSession implements GameplaySession {
    public readonly kind = "online" as const;
    public readonly controlPolicy = ONLINE_CONTROL_POLICY;

    private readonly client: MultiplayerTransport;
    private readonly credentialStore: ReconnectCredentialStore;
    private readonly createCommandId: () => string;
    private readonly listeners =
        new Set<(state: Readonly<RoomSessionState>) => void>();
    private readonly unsubscribeConnection: () => void;
    private readonly unsubscribeMessages: () => void;

    private state: RoomSessionState;
    private credentials: SessionCredentials | null = null;
    private resumeInFlight = false;
    private destroyed = false;

    public constructor(options: RoomSessionOptions) {
        this.client = options.client;
        this.credentialStore = options.credentialStore;
        this.createCommandId =
            options.createCommandId ??
            (() => globalThis.crypto.randomUUID());
        this.credentials = this.credentialStore.load();
        this.state = {
            connectionState: this.client.getConnectionState(),
            room: null,
            localPlayerId: this.credentials?.playerId ?? null,
            lastError: null,
        };

        this.unsubscribeConnection =
            this.client.subscribeConnection(
                this.handleConnectionState,
            );
        this.unsubscribeMessages =
            this.client.subscribeMessages(this.handleMessage);
    }

    public getState(): Readonly<RoomSessionState> {
        return this.state;
    }

    public subscribe(
        listener: (state: Readonly<RoomSessionState>) => void,
    ): () => void {
        this.listeners.add(listener);
        listener(this.state);

        return () => {
            this.listeners.delete(listener);
        };
    }

    public async connect(resumeStored = true): Promise<void> {
        await this.client.connect();

        if (resumeStored && this.credentials && !this.state.room) {
            await this.resumeStoredSession();
        }
    }

    public disconnect(): void {
        this.client.disconnect();
    }

    public async createRoom(displayName: string): Promise<RoomState> {
        await this.ensureConnected();
        const response = await this.client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "room.create",
            commandId: this.createCommandId(),
            payload: { displayName },
        });

        return this.acceptJoinResponse(response, "room.created");
    }

    public async joinRoom(
        roomCode: string,
        displayName: string,
    ): Promise<RoomState> {
        await this.ensureConnected();
        const response = await this.client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "room.join",
            commandId: this.createCommandId(),
            payload: { roomCode, displayName },
        });

        return this.acceptJoinResponse(response, "room.joined");
    }

    public async resumeStoredSession(): Promise<RoomState | null> {
        if (this.resumeInFlight) {
            return this.state.room;
        }

        const credentials =
            this.credentials ?? this.credentialStore.load();

        if (!credentials) {
            return null;
        }

        this.resumeInFlight = true;

        try {
            await this.ensureConnected();
            const response = await this.client.send({
                protocolVersion: PROTOCOL_VERSION,
                type: "room.resume",
                commandId: this.createCommandId(),
                payload: credentials,
            });

            return this.acceptJoinResponse(response, "room.resumed");
        } catch (error) {
            if (error instanceof RoomCommandRejectedError) {
                if (
                    error.code === "room-not-found" ||
                    error.code === "reconnect-token-invalid" ||
                    error.code === "reconnect-grace-expired"
                ) {
                    this.clearRoomState();
                }
            }

            this.setError(error);
            throw error;
        } finally {
            this.resumeInFlight = false;
        }
    }

    public async sendCommand(
        command: ClientCommand,
    ): Promise<ServerMessage> {
        const response = await this.client.send(command);
        this.throwIfRejected(response);
        return response;
    }

    public async setSelection(
        selection: ProposedRoomSelection,
    ): Promise<void> {
        const room = this.state.room;
        if (!room) {
            throw new Error("Join a room before selecting a chart.");
        }

        const response = await this.client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "selection.set",
            commandId: this.createCommandId(),
            roomId: room.roomId,
            expectedRoomRevision: room.revision,
            payload: { selection },
        });
        this.throwIfRejected(response);
    }

    public async publishPreview(preview: ProposedRoomPreview): Promise<void> {
        await this.sendRevisioned("preview.publish", { preview });
    }

    public async clearPreview(): Promise<void> {
        await this.sendRevisioned("preview.clear", {});
    }

    public async commitSongPackage(songPackage: ProposedSongPackage): Promise<void> {
        await this.sendRevisioned("songPackage.commit", { songPackage });
    }

    public async selectPlayerChart(choice: PlayerChartChoice): Promise<void> {
        await this.sendRevisioned("player.chart.select", { choice });
    }

    public async reportAssetPreparation(preparation: PlayerAssetPreparation): Promise<void> {
        await this.sendRevisioned("player.asset.status", { preparation });
    }

    public async requestAssetUpload(asset: RelayAssetUploadProposal): Promise<AssetUploadGrant> {
        const room = this.requireRoom();
        const response = await this.client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "asset.upload.request",
            commandId: this.createCommandId(),
            roomId: room.roomId,
            payload: { asset },
        });
        this.throwIfRejected(response);
        if (response.type !== "asset.upload.granted") throw new Error("The server did not grant the asset upload.");
        return response;
    }

    public async requestAssetDownload(assetId: string): Promise<AssetDownloadGrant> {
        const room = this.requireRoom();
        const response = await this.client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "asset.download.request",
            commandId: this.createCommandId(),
            roomId: room.roomId,
            payload: { assetId },
        });
        this.throwIfRejected(response);
        if (response.type !== "asset.download.granted") throw new Error("The server did not grant the asset download.");
        return response;
    }

    public async reportAvailability(
        availability: Availability,
    ): Promise<void> {
        await this.sendRevisioned("player.availability", {
            availability,
        });
    }

    public async setReady(ready: boolean): Promise<void> {
        await this.sendRevisioned("player.ready", { ready });
    }

    public async kickPlayer(playerId: string): Promise<void> {
        await this.retryRevisioned(() =>
            this.sendRevisioned("player.kick", { playerId }));
    }

    public async reportClockQuality(usable: boolean): Promise<void> {
        await this.sendRevisioned("player.clockQuality", { usable });
    }

    public async pingClock(clientSentAtPerformanceMs: number): Promise<Extract<ServerMessage, { type: "clock.pong" }>> {
        const room = this.requireRoom();
        const response = await this.client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "clock.ping",
            commandId: this.createCommandId(),
            roomId: room.roomId,
            payload: { clientSentAtPerformanceMs },
        });
        this.throwIfRejected(response);
        if (response.type !== "clock.pong") throw new Error("The server did not return a clock sample.");
        return response;
    }

    public async requestCountdown(): Promise<void> {
        await this.sendRevisioned("countdown.request", {});
    }

    public async confirmCountdownScheduled(): Promise<void> {
        await this.sendRevisioned("countdown.scheduled", {});
    }

    public async reportCountdownFailed(): Promise<void> {
        await this.sendRevisioned("countdown.failed", {});
    }

    public async reportGameFinished(result: FinalResult): Promise<void> {
        const room = this.requireRoom();
        const response = await this.client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "game.finished",
            commandId: this.createCommandId(),
            roomId: room.roomId,
            payload: { result },
        });
        this.throwIfRejected(response);
    }

    public async reportScore(score: LiveScore): Promise<void> {
        const room = this.requireRoom();
        const response = await this.client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "game.score",
            commandId: this.createCommandId(),
            roomId: room.roomId,
            payload: { score },
        });
        this.throwIfRejected(response);
    }

    public async voteReplay(wantsReplay: boolean): Promise<void> {
        await this.retryRevisioned(() => this.sendRevisioned("results.replayVote", { wantsReplay }));
    }

    public async confirmReplay(): Promise<void> {
        await this.retryRevisioned(() => this.sendRevisioned("results.replay", {}));
    }

    public async returnToSelection(): Promise<void> {
        await this.retryRevisioned(() => this.sendRevisioned("results.returnToSelection", {}));
    }

    public async beginReadyCheck(): Promise<void> {
        await this.sendRevisioned("readyCheck.begin", {});
    }

    public async cancelReadyCheck(): Promise<void> {
        await this.sendRevisioned("readyCheck.cancel", {});
    }

    public async leaveRoom(): Promise<void> {
        const room = this.state.room;

        if (!room || this.state.connectionState !== "connected") {
            this.clearRoomState();
            return;
        }

        const response = await this.client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "room.leave",
            commandId: this.createCommandId(),
            roomId: room.roomId,
            payload: {},
        });
        this.throwIfRejected(response);
        this.clearRoomState();
    }

    public destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.unsubscribeConnection();
        this.unsubscribeMessages();
        this.listeners.clear();
        this.client.destroy();
    }

    private acceptJoinResponse(
        response: ServerMessage,
        expectedType: "room.created" | "room.joined" | "room.resumed",
    ): RoomState {
        this.throwIfRejected(response);

        if (response.type !== expectedType) {
            throw new Error(
                `Expected ${expectedType}, received ${response.type}.`,
            );
        }

        this.credentials = response.credentials;
        this.credentialStore.save(response.credentials);
        this.state = {
            ...this.state,
            localPlayerId: response.credentials.playerId,
            lastError: null,
        };
        this.acceptRoomSnapshot(response.room);
        return response.room;
    }

    private async sendRevisioned(
        type:
            | "player.availability"
            | "player.ready"
            | "player.clockQuality"
            | "player.kick"
            | "readyCheck.begin"
            | "readyCheck.cancel"
            | "preview.publish"
            | "preview.clear"
            | "songPackage.commit"
            | "player.chart.select"
            | "player.asset.status"
            | "countdown.request"
            | "countdown.scheduled"
            | "countdown.failed"
            | "results.replayVote"
            | "results.replay"
            | "results.returnToSelection",
        payload: RevisionedCommandPayload,
    ): Promise<void> {
        const room = this.state.room;
        if (!room) {
            throw new Error("Join a room before sending room commands.");
        }

        const command = {
            protocolVersion: PROTOCOL_VERSION,
            type,
            commandId: this.createCommandId(),
            roomId: room.roomId,
            expectedRoomRevision: room.revision,
            payload,
        } as ClientCommand;
        const response = await this.client.send(command);
        this.throwIfRejected(response);
    }

    private requireRoom(): RoomState {
        if (!this.state.room) throw new Error("Join a room before transferring assets.");
        return this.state.room;
    }

    private async retryRevisioned(action: () => Promise<void>): Promise<void> {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            try { await action(); return; } catch (error) {
                if (!(error instanceof RoomCommandRejectedError) || error.code !== "stale-room-revision" || attempt === 3) throw error;
                await new Promise((resolve) => setTimeout(resolve, 75));
            }
        }
    }

    private acceptRoomSnapshot(room: RoomState): void {
        const currentRoom = this.state.room;

        if (
            currentRoom &&
            currentRoom.roomId === room.roomId &&
            room.revision <= currentRoom.revision
        ) {
            return;
        }

        this.state = {
            ...this.state,
            room,
            lastError: null,
        };
        this.notify();
    }

    private readonly handleConnectionState = (
        connectionState: MultiplayerConnectionState,
    ): void => {
        const previousConnectionState = this.state.connectionState;
        this.state = {
            ...this.state,
            connectionState,
        };
        this.notify();

        if (
            connectionState === "connected" &&
            (previousConnectionState === "reconnecting" ||
                previousConnectionState === "disconnected") &&
            this.credentials &&
            !this.resumeInFlight
        ) {
            void this.resumeStoredSession().catch(() => {
                // The session state already exposes the typed resume error.
            });
        }
    };

    private readonly handleMessage = (message: ServerMessage): void => {
        if (message.type === "room.snapshot") {
            if (
                this.credentials &&
                message.room.roomId === this.credentials.roomId
            ) {
                this.acceptRoomSnapshot(message.room);
            }
            return;
        }

        if (
            message.type === "room.closed" &&
            this.credentials?.roomId === message.roomId
        ) {
            this.state = {
                ...this.state,
                lastError: message.message,
            };
            this.clearRoomState(false);
        }
    };

    private throwIfRejected(response: ServerMessage): void {
        if (response.type === "command.rejected") {
            throw new RoomCommandRejectedError(
                response.code,
                response.message,
                response.roomRevision,
            );
        }

        if (response.type === "server.error") {
            throw new Error(response.message);
        }

        if (response.type === "command.accepted" && response.room) {
            this.acceptRoomSnapshot(response.room);
        }
    }

    private async ensureConnected(): Promise<void> {
        if (this.client.getConnectionState() !== "connected") {
            await this.client.connect();
        }
    }

    private setError(error: unknown): void {
        this.state = {
            ...this.state,
            lastError:
                error instanceof Error
                    ? error.message
                    : "An unknown multiplayer error occurred.",
        };
        this.notify();
    }

    private clearRoomState(clearError = true): void {
        this.credentials = null;
        this.credentialStore.clear();
        this.state = {
            ...this.state,
            room: null,
            localPlayerId: null,
            lastError: clearError ? null : this.state.lastError,
        };
        this.notify();
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener(this.state);
        }
    }
}
