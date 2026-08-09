import {
    randomBytes,
    randomInt,
    randomUUID,
} from "node:crypto";

import { PROTOCOL_VERSION } from "../shared/constants";
import type {
    ClientCommand,
    RejectionCode,
    RoomState,
    ServerMessage,
} from "../shared/schemas";
import {
    createRoomState,
    transitionRoom,
} from "./domain/roomStateMachine";
import type {
    RoomAction,
    RoomTransitionRejected,
} from "./domain/roomStateMachine";

interface RoomRecord {
    state: RoomState;
    reconnectTokens: Map<string, string>;
}

interface Membership {
    roomId: string;
    playerId: string;
}

export interface RoomMemberContext extends Membership {
    roomRevision: number;
    isHost: boolean;
}

export interface RegistryEffect {
    roomId: string;
    message: ServerMessage;
    closeRoom: boolean;
}

export interface RegistryResult {
    response: ServerMessage;
    effects: RegistryEffect[];
    joinedRoomId?: string;
    leftRoomId?: string;
    kickedSocketId?: string;
    kickedPlayerId?: string;
    kickedRoomId?: string;
}

export interface RoomRegistryOptions {
    now?: () => number;
    createRoomId?: () => string;
    createPlayerId?: () => string;
    createReconnectToken?: () => string;
    createRoomCode?: () => string;
}

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomRegistry {
    private readonly rooms = new Map<string, RoomRecord>();
    private readonly roomIdsByCode = new Map<string, string>();
    private readonly memberships = new Map<string, Membership>();

    private readonly now: () => number;
    private readonly createRoomId: () => string;
    private readonly createPlayerId: () => string;
    private readonly createReconnectToken: () => string;
    private readonly createRoomCode: () => string;

    public constructor(options: RoomRegistryOptions = {}) {
        this.now = options.now ?? Date.now;
        this.createRoomId = options.createRoomId ?? randomUUID;
        this.createPlayerId = options.createPlayerId ?? randomUUID;
        this.createReconnectToken =
            options.createReconnectToken ??
            (() => randomBytes(32).toString("hex"));
        this.createRoomCode =
            options.createRoomCode ?? createRandomRoomCode;
    }

    public getRoomCount(): number {
        return this.rooms.size;
    }

    public getMembership(socketId: string): Membership | null {
        return this.memberships.get(socketId) ?? null;
    }

    public getMemberContext(
        socketId: string,
        roomId: string,
    ): RoomMemberContext | null {
        const membership = this.memberships.get(socketId);
        const record = this.rooms.get(roomId);
        if (!membership || membership.roomId !== roomId || !record) {
            return null;
        }
        return {
            ...membership,
            roomRevision: record.state.revision,
            isHost: record.state.hostPlayerId === membership.playerId,
        };
    }

    public createRoom(
        socketId: string,
        command: Extract<ClientCommand, { type: "room.create" }>,
    ): RegistryResult {
        if (this.memberships.has(socketId)) {
            return this.rejection(
                command.commandId,
                "invalid-command",
                "Leave the current room before creating another.",
                null,
            );
        }

        const roomId = this.createRoomId();
        const playerId = this.createPlayerId();
        const reconnectToken = this.createReconnectToken();
        const roomCode = this.generateUniqueRoomCode();
        const nowMs = this.now();

        const state = createRoomState({
            roomId,
            roomCode,
            hostPlayerId: playerId,
            hostDisplayName: command.payload.displayName,
            nowMs,
        });

        this.rooms.set(roomId, {
            state,
            reconnectTokens: new Map([
                [playerId, reconnectToken],
            ]),
        });
        this.roomIdsByCode.set(roomCode, roomId);
        this.memberships.set(socketId, { roomId, playerId });

        return {
            response: {
                protocolVersion: PROTOCOL_VERSION,
                type: "room.created",
                room: state,
                credentials: {
                    roomId,
                    playerId,
                    reconnectToken,
                },
            },
            effects: [],
            joinedRoomId: roomId,
        };
    }

    public joinRoom(
        socketId: string,
        command: Extract<ClientCommand, { type: "room.join" }>,
    ): RegistryResult {
        if (this.memberships.has(socketId)) {
            return this.rejection(
                command.commandId,
                "invalid-command",
                "Leave the current room before joining another.",
                null,
            );
        }

        const roomId = this.roomIdsByCode.get(
            command.payload.roomCode,
        );
        const record = roomId
            ? this.rooms.get(roomId)
            : undefined;

        if (!roomId || !record) {
            return this.rejection(
                command.commandId,
                "room-not-found",
                "That room code is invalid or expired.",
                null,
            );
        }

        const playerId = this.createPlayerId();
        const reconnectToken = this.createReconnectToken();
        const transition = transitionRoom(record.state, {
            type: "player.join",
            playerId,
            displayName: command.payload.displayName,
            nowMs: this.now(),
        });

        if (!transition.accepted) {
            return this.transitionRejection(
                command.commandId,
                transition,
            );
        }

        record.state = transition.state;
        record.reconnectTokens.set(playerId, reconnectToken);
        this.memberships.set(socketId, { roomId, playerId });

        return {
            response: {
                protocolVersion: PROTOCOL_VERSION,
                type: "room.joined",
                room: record.state,
                credentials: {
                    roomId,
                    playerId,
                    reconnectToken,
                },
            },
            effects: [this.snapshotEffect(record.state)],
            joinedRoomId: roomId,
        };
    }

    public resumeRoom(
        socketId: string,
        command: Extract<ClientCommand, { type: "room.resume" }>,
    ): RegistryResult {
        if (this.memberships.has(socketId)) {
            return this.rejection(
                command.commandId,
                "invalid-command",
                "This connection already belongs to a room.",
                null,
            );
        }

        const record = this.rooms.get(command.payload.roomId);

        if (!record) {
            return this.rejection(
                command.commandId,
                "room-not-found",
                "The room no longer exists.",
                null,
            );
        }

        const expectedToken = record.reconnectTokens.get(
            command.payload.playerId,
        );

        if (
            !expectedToken ||
            expectedToken !== command.payload.reconnectToken
        ) {
            return this.rejection(
                command.commandId,
                "reconnect-token-invalid",
                "The reconnect credentials are invalid.",
                record.state.revision,
            );
        }

        const player = record.state.players.find(
            (candidate) =>
                candidate.playerId === command.payload.playerId,
        );

        if (!player) {
            return this.rejection(
                command.commandId,
                "reconnect-grace-expired",
                "The reconnect window has expired.",
                record.state.revision,
            );
        }

        if (player.connectionStatus === "connected") {
            return this.rejection(
                command.commandId,
                "invalid-command",
                "That player is already connected.",
                record.state.revision,
            );
        }

        const transition = transitionRoom(record.state, {
            type: "player.resume",
            playerId: command.payload.playerId,
            nowMs: this.now(),
        });

        if (!transition.accepted) {
            return this.transitionRejection(
                command.commandId,
                transition,
            );
        }

        record.state = transition.state;
        this.memberships.set(socketId, {
            roomId: command.payload.roomId,
            playerId: command.payload.playerId,
        });

        return {
            response: {
                protocolVersion: PROTOCOL_VERSION,
                type: "room.resumed",
                room: record.state,
                credentials: {
                    roomId: command.payload.roomId,
                    playerId: command.payload.playerId,
                    reconnectToken: command.payload.reconnectToken,
                },
            },
            effects: [this.snapshotEffect(record.state)],
            joinedRoomId: command.payload.roomId,
        };
    }

    public handleMemberCommand(
        socketId: string,
        command: Exclude<
            ClientCommand,
            | { type: "room.create" }
            | { type: "room.join" }
            | { type: "room.resume" }
            | { type: "clock.ping" }
            | { type: "asset.upload.request" }
            | { type: "asset.download.request" }
        >,
    ): RegistryResult {
        const membership = this.memberships.get(socketId);

        if (!membership || membership.roomId !== command.roomId) {
            return this.rejection(
                command.commandId,
                "not-a-member",
                "This connection is not a member of that room.",
                null,
            );
        }

        const record = this.rooms.get(membership.roomId);

        if (!record) {
            this.memberships.delete(socketId);
            return this.rejection(
                command.commandId,
                "room-not-found",
                "The room no longer exists.",
                null,
            );
        }

        const action = this.toRoomAction(
            command,
            membership.playerId,
            record.state,
        );
        const transition = transitionRoom(record.state, action);

        if (!transition.accepted) {
            return this.transitionRejection(
                command.commandId,
                transition,
            );
        }

        record.state = transition.state;
        const effects: RegistryEffect[] = [];
        const result: RegistryResult = {
            response: {
                protocolVersion: PROTOCOL_VERSION,
                type: "command.accepted",
                commandId: command.commandId,
                roomRevision: transition.state.revision,
                room: transition.state,
            },
            effects,
        };

        if (command.type === "player.kick") {
            const kickedMembership = [...this.memberships.entries()].find(
                ([, candidate]) =>
                    candidate.roomId === membership.roomId &&
                    candidate.playerId === command.payload.playerId,
            );
            if (kickedMembership) {
                result.kickedSocketId = kickedMembership[0];
                result.kickedPlayerId = command.payload.playerId;
                result.kickedRoomId = membership.roomId;
                this.memberships.delete(kickedMembership[0]);
            }
            record.reconnectTokens.delete(command.payload.playerId);
        }

        if (command.type === "room.leave") {
            record.reconnectTokens.delete(membership.playerId);
            this.memberships.delete(socketId);
            result.leftRoomId = membership.roomId;
        }

        if (transition.state.phase === "closed") {
            effects.push(this.closedEffect(transition.state));
            this.deleteRoom(membership.roomId);
        } else {
            effects.push(this.snapshotEffect(transition.state));
        }

        return result;
    }

    public handleClockPing(
        socketId: string,
        command: Extract<ClientCommand, { type: "clock.ping" }>,
        receivedAtMs: number,
    ): RegistryResult {
        const membership = this.memberships.get(socketId);

        if (!membership || membership.roomId !== command.roomId) {
            return this.rejection(
                command.commandId,
                "not-a-member",
                "Join the room before synchronizing clocks.",
                null,
            );
        }

        return {
            response: {
                protocolVersion: PROTOCOL_VERSION,
                type: "clock.pong",
                clientSentAtPerformanceMs:
                    command.payload.clientSentAtPerformanceMs,
                serverReceivedAtMs: receivedAtMs,
                serverSentAtMs: this.now(),
            },
            effects: [],
        };
    }

    public disconnect(socketId: string): RegistryEffect[] {
        const membership = this.memberships.get(socketId);
        this.memberships.delete(socketId);

        if (!membership) {
            return [];
        }

        const record = this.rooms.get(membership.roomId);

        if (!record) {
            return [];
        }

        const transition = transitionRoom(record.state, {
            type: "player.disconnect",
            playerId: membership.playerId,
            nowMs: this.now(),
        });

        if (!transition.accepted) {
            return [];
        }

        record.state = transition.state;
        return [this.snapshotEffect(record.state)];
    }

    public tick(): RegistryEffect[] {
        const effects: RegistryEffect[] = [];
        const nowMs = this.now();

        for (const [roomId, record] of this.rooms) {
            const transition = transitionRoom(record.state, {
                type: "server.tick",
                nowMs,
            });

            if (!transition.accepted || transition.state === record.state) {
                continue;
            }

            record.state = transition.state;

            if (record.state.phase === "closed") {
                effects.push(this.closedEffect(record.state));
                this.deleteRoom(roomId);
            } else {
                effects.push(this.snapshotEffect(record.state));
            }
        }

        return effects;
    }

    private toRoomAction(
        command: Exclude<
            ClientCommand,
            | { type: "room.create" }
            | { type: "room.join" }
            | { type: "room.resume" }
            | { type: "clock.ping" }
            | { type: "asset.upload.request" }
            | { type: "asset.download.request" }
        >,
        actorPlayerId: string,
        state: RoomState,
    ): RoomAction {
        const nowMs = this.now();
        const expectedRoomRevision =
            "expectedRoomRevision" in command
                ? command.expectedRoomRevision
                : state.revision;
        const base = {
            actorPlayerId,
            expectedRoomRevision,
            nowMs,
        };

        switch (command.type) {
            case "room.leave":
                return { type: "player.leave", ...base };
            case "room.close":
                return { type: "room.close", ...base };
            case "player.rename":
                return {
                    type: "player.rename",
                    displayName: command.payload.displayName,
                    ...base,
                };
            case "player.availability":
                return {
                    type: "player.availability",
                    availability: command.payload.availability,
                    ...base,
                };
            case "player.ready":
                return {
                    type: "player.ready",
                    ready: command.payload.ready,
                    ...base,
                };
            case "player.clockQuality":
                return { type: "player.clockQuality", usable: command.payload.usable, ...base };
            case "player.kick":
                return { type: "player.kick", playerId: command.payload.playerId, ...base };
            case "selection.set":
                return {
                    type: "selection.set",
                    selection: command.payload.selection,
                    ...base,
                };
            case "selection.clear":
                return { type: "selection.clear", ...base };
            case "preview.publish":
                return {
                    type: "preview.publish",
                    preview: command.payload.preview,
                    ...base,
                };
            case "preview.clear":
                return { type: "preview.clear", ...base };
            case "songPackage.commit":
                return { type: "songPackage.commit", songPackage: command.payload.songPackage, ...base };
            case "player.chart.select":
                return { type: "player.chart.select", choice: command.payload.choice, ...base };
            case "player.asset.status":
                return { type: "player.asset.status", preparation: command.payload.preparation, ...base };
            case "readyCheck.begin":
                return { type: "readyCheck.begin", ...base };
            case "readyCheck.cancel":
                return { type: "readyCheck.cancel", ...base };
            case "countdown.request":
                return { type: "countdown.request", ...base };
            case "countdown.cancel":
                return { type: "countdown.cancel", ...base };
            case "countdown.scheduled":
                return { type: "countdown.scheduled", ...base };
            case "countdown.failed":
                return { type: "countdown.failed", ...base };
            case "game.score":
                return {
                    type: "game.score",
                    score: command.payload.score,
                    ...base,
                };
            case "game.finished":
                return {
                    type: "game.finished",
                    result: command.payload.result,
                    ...base,
                };
            case "results.replay":
                return { type: "results.replay", ...base };
            case "results.replayVote":
                return { type: "results.replayVote", wantsReplay: command.payload.wantsReplay, ...base };
            case "results.returnToSelection":
                return {
                    type: "results.returnToSelection",
                    ...base,
                };
        }
    }

    private generateUniqueRoomCode(): string {
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const code = this.createRoomCode().toUpperCase();
            if (
                /^[A-HJ-NP-Z2-9]{6}$/.test(code) &&
                !this.roomIdsByCode.has(code)
            ) {
                return code;
            }
        }

        throw new Error("Could not allocate a unique room code.");
    }

    private snapshotEffect(state: RoomState): RegistryEffect {
        return {
            roomId: state.roomId,
            closeRoom: false,
            message: {
                protocolVersion: PROTOCOL_VERSION,
                type: "room.snapshot",
                room: state,
            },
        };
    }

    private closedEffect(state: RoomState): RegistryEffect {
        return {
            roomId: state.roomId,
            closeRoom: true,
            message: {
                protocolVersion: PROTOCOL_VERSION,
                type: "room.closed",
                roomId: state.roomId,
                reason: state.closeReason ?? "room-empty",
                message: this.closeMessage(state.closeReason),
            },
        };
    }

    private closeMessage(reason: RoomState["closeReason"]): string {
        switch (reason) {
            case "host-closed":
                return "The host closed the room.";
            case "room-expired":
                return "The room expired due to inactivity.";
            case "room-empty":
            case null:
                return "The room is empty.";
            case "kicked":
                return "The host removed you from the room.";
        }
    }

    private transitionRejection(
        commandId: string,
        transition: RoomTransitionRejected,
    ): RegistryResult {
        return this.rejection(
            commandId,
            transition.code,
            transition.message,
            transition.state.revision,
        );
    }

    private rejection(
        commandId: string,
        code: RejectionCode,
        message: string,
        roomRevision: number | null,
    ): RegistryResult {
        return {
            response: {
                protocolVersion: PROTOCOL_VERSION,
                type: "command.rejected",
                commandId,
                code,
                message,
                roomRevision,
            },
            effects: [],
        };
    }

    private deleteRoom(roomId: string): void {
        const record = this.rooms.get(roomId);
        if (record) {
            this.roomIdsByCode.delete(record.state.roomCode);
        }
        this.rooms.delete(roomId);

        for (const [socketId, membership] of this.memberships) {
            if (membership.roomId === roomId) {
                this.memberships.delete(socketId);
            }
        }
    }
}

function createRandomRoomCode(): string {
    let code = "";

    for (let index = 0; index < 6; index += 1) {
        code += ROOM_CODE_ALPHABET[
            randomInt(ROOM_CODE_ALPHABET.length)
        ];
    }

    return code;
}
