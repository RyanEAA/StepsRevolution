import { describe, expect, it } from "vitest";

import {
    CHART_IDENTITY_VERSION,
    PROTOCOL_VERSION,
} from "./constants";
import {
    clientCommandSchema,
    roomStateSchema,
    serverMessageSchema,
} from "./schemas";
import { createRoomState } from "../server/domain/roomStateMachine";

describe("multiplayer protocol schemas", () => {
    it("accepts a canonical room state", () => {
        const room = createRoomState({
            roomId: "room-1",
            roomCode: "ABC234",
            hostPlayerId: "host",
            hostDisplayName: "Ryan",
            nowMs: 1_000,
        });

        expect(roomStateSchema.parse(room)).toEqual(room);
    });

    it("rejects a mismatched protocol version", () => {
        const parsed = clientCommandSchema.safeParse({
            protocolVersion: PROTOCOL_VERSION + 1,
            type: "room.create",
            commandId: "command-1",
            payload: { displayName: "Ryan" },
        });

        expect(parsed.success).toBe(false);
    });

    it("normalizes a join code and rejects unknown payload fields", () => {
        const valid = clientCommandSchema.parse({
            protocolVersion: PROTOCOL_VERSION,
            type: "room.join",
            commandId: "command-1",
            payload: {
                roomCode: "abc234",
                displayName: "Guest",
            },
        });

        expect(valid.payload).toMatchObject({ roomCode: "ABC234" });

        const invalid = clientCommandSchema.safeParse({
            protocolVersion: PROTOCOL_VERSION,
            type: "room.join",
            commandId: "command-2",
            payload: {
                roomCode: "ABC234",
                displayName: "Guest",
                unexpected: true,
            },
        });

        expect(invalid.success).toBe(false);
    });

    it("requires the current chart identity prefix", () => {
        const baseCommand = {
            protocolVersion: PROTOCOL_VERSION,
            type: "selection.set",
            commandId: "command-1",
            roomId: "room-1",
            expectedRoomRevision: 0,
            payload: {
                selection: {
                    identityVersion: CHART_IDENTITY_VERSION,
                    songId: "song-1",
                    chartId: "chart-1",
                    chartHash: "wrong-version:abc",
                    title: "Song",
                    subtitle: "",
                    artist: "Artist",
                    stepType: "dance-single",
                    difficulty: "Hard",
                    meter: 8,
                    tapCount: 100,
                    durationSeconds: 120,
                },
            },
        };

        expect(clientCommandSchema.safeParse(baseCommand).success).toBe(false);
    });

    it("validates server clock responses and rejects unknown message types", () => {
        const pong = serverMessageSchema.safeParse({
            protocolVersion: PROTOCOL_VERSION,
            type: "clock.pong",
            clientSentAtPerformanceMs: 10,
            serverReceivedAtMs: 20,
            serverSentAtMs: 21,
        });
        expect(pong.success).toBe(true);

        expect(serverMessageSchema.safeParse({
            protocolVersion: PROTOCOL_VERSION,
            type: "room.mystery",
        }).success).toBe(false);
    });
});
