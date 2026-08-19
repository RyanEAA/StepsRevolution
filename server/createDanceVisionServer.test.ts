import { afterEach, describe, expect, it } from "vitest";
import { io } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import {
    CHART_IDENTITY_VERSION,
    PROTOCOL_VERSION,
    RECONNECT_GRACE_MS,
} from "../shared/constants";
import {
    serverMessageSchema,
} from "../shared/schemas";
import type {
    ClientCommand,
    ServerMessage,
} from "../shared/schemas";
import { DanceVisionServer } from "./createDanceVisionServer";

import { AssetRelayError, AssetRelayService } from "./assetRelayService";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const roots: string[] = [];

let server: DanceVisionServer | null = null;
const clients: ClientSocket[] = [];

afterEach(async () => {
    for (const client of clients.splice(0)) {
        client.disconnect();
    }

    if (server) {
        await server.stop();
        server = null;
    }

    for (const root of roots.splice(0)) {
        await rm(root, {
            recursive: true,
            force: true,
        });
    }
});

function createRegistryOptions(now: () => number) {
    let playerNumber = 0;

    return {
        now,
        createRoomId: () => "room-1",
        createPlayerId: () => `player-${++playerNumber}`,
        createReconnectToken: () =>
            `${playerNumber}`.repeat(64).slice(0, 64),
        createRoomCode: () => "ABC234",
    };
}

async function startServer(now: () => number = Date.now) {
    server = new DanceVisionServer({
        port: 0,
        tickIntervalMs: 10,
        registryOptions: createRegistryOptions(now),
    });

    return server.start();
}

async function connect(url: string): Promise<ClientSocket> {
    const client = io(url, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
    });
    clients.push(client);

    await new Promise<void>((resolve, reject) => {
        client.once("connect", () => resolve());
        client.once("connect_error", reject);
    });

    return client;
}

function send(
    client: ClientSocket,
    command: ClientCommand | unknown,
): Promise<ServerMessage> {
    return new Promise((resolve) => {
        client.emit("command", command, (rawResponse: unknown) => {
            resolve(serverMessageSchema.parse(rawResponse));
        });
    });
}

function waitForMessage(
    client: ClientSocket,
    predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
    return new Promise((resolve) => {
        const listener = (rawMessage: unknown) => {
            const message = serverMessageSchema.parse(rawMessage);
            if (predicate(message)) {
                client.off("message", listener);
                resolve(message);
            }
        };
        client.on("message", listener);
    });
}

async function createRoom(client: ClientSocket) {
    return send(client, {
        protocolVersion: PROTOCOL_VERSION,
        type: "room.create",
        commandId: "create-1",
        payload: { displayName: "Host" },
    });
}

async function waitUntil(
    predicate: () => boolean,
    timeoutMs = 1_000,
): Promise<void> {
    const startedAt = Date.now();

    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error("Timed out waiting for condition.");
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

describe("Dance Vision room server", () => {
    it("serves health state and creates an in-memory room", async () => {
        const url = await startServer();
        const initialHealth = await fetch(`${url}/health`);
        expect(await initialHealth.json()).toEqual({
            status: "ok",
            protocolVersion: PROTOCOL_VERSION,
            rooms: 0,
        });

        const host = await connect(url);
        const response = await createRoom(host);

        expect(response.type).toBe("room.created");
        if (response.type !== "room.created") {
            throw new Error("Expected room.created.");
        }
        expect(response.room.roomCode).toBe("ABC234");
        expect(response.room.players[0]?.displayName).toBe("Host");
        expect(response.credentials.reconnectToken).toHaveLength(64);

        const health = await fetch(`${url}/health`);
        expect((await health.json()).rooms).toBe(1);
    });

    it("joins two clients and broadcasts a canonical snapshot", async () => {
        const url = await startServer();
        const host = await connect(url);
        const guest = await connect(url);
        await createRoom(host);

        const snapshotPromise = waitForMessage(
            host,
            (message) =>
                message.type === "room.snapshot" &&
                message.room.players.length === 2,
        );

        const joined = await send(guest, {
            protocolVersion: PROTOCOL_VERSION,
            type: "room.join",
            commandId: "join-1",
            payload: {
                roomCode: "abc234",
                displayName: "Guest",
            },
        });

        expect(joined.type).toBe("room.joined");
        const snapshot = await snapshotPromise;
        expect(snapshot.type).toBe("room.snapshot");
        if (snapshot.type === "room.snapshot") {
            expect(snapshot.room.revision).toBe(1);
            expect(snapshot.room.players).toHaveLength(2);
        }
    });

    it("validates commands and enforces host authority", async () => {
        const url = await startServer();
        const host = await connect(url);
        const guest = await connect(url);
        const created = await createRoom(host);
        if (created.type !== "room.created") {
            throw new Error("Expected room.created.");
        }

        const joined = await send(guest, {
            protocolVersion: PROTOCOL_VERSION,
            type: "room.join",
            commandId: "join-1",
            payload: {
                roomCode: created.room.roomCode,
                displayName: "Guest",
            },
        });
        if (joined.type !== "room.joined") {
            throw new Error("Expected room.joined.");
        }

        const malformed = await send(guest, {
            protocolVersion: 999,
            type: "room.join",
            commandId: "bad-version",
            payload: {},
        });
        expect(malformed).toMatchObject({
            type: "command.rejected",
            code: "protocol-version-mismatch",
        });

        const rejected = await send(guest, {
            protocolVersion: PROTOCOL_VERSION,
            type: "selection.set",
            commandId: "guest-selection",
            roomId: created.room.roomId,
            expectedRoomRevision: joined.room.revision,
            payload: {
                selection: {
                    songId: "song-1",
                    chartId: "chart-1",
                    chartHash:
                        `${CHART_IDENTITY_VERSION}:${"a".repeat(64)}`,
                    identityVersion: CHART_IDENTITY_VERSION,
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
        });

        expect(rejected).toMatchObject({
            type: "command.rejected",
            code: "not-host",
            roomRevision: joined.room.revision,
        });
    });

    it("supports clock pong and typed invalid-room errors", async () => {
        const url = await startServer();
        const client = await connect(url);

        const missing = await send(client, {
            protocolVersion: PROTOCOL_VERSION,
            type: "room.join",
            commandId: "join-missing",
            payload: {
                roomCode: "ZZZ999",
                displayName: "Guest",
            },
        });
        expect(missing).toMatchObject({
            type: "command.rejected",
            code: "room-not-found",
        });

        const created = await createRoom(client);
        if (created.type !== "room.created") {
            throw new Error("Expected room.created.");
        }

        const pong = await send(client, {
            protocolVersion: PROTOCOL_VERSION,
            type: "clock.ping",
            commandId: "ping-1",
            roomId: created.room.roomId,
            payload: { clientSentAtPerformanceMs: 42 },
        });
        expect(pong).toMatchObject({
            type: "clock.pong",
            clientSentAtPerformanceMs: 42,
        });
    });

    it("resumes a disconnected player with its secret token", async () => {
        let nowMs = 1_000;
        const url = await startServer(() => nowMs);
        const original = await connect(url);
        const created = await createRoom(original);
        if (created.type !== "room.created") {
            throw new Error("Expected room.created.");
        }

        original.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 20));
        nowMs += 1_000;

        const resumedClient = await connect(url);
        const resumed = await send(resumedClient, {
            protocolVersion: PROTOCOL_VERSION,
            type: "room.resume",
            commandId: "resume-1",
            payload: created.credentials,
        });

        expect(resumed.type).toBe("room.resumed");
        if (resumed.type === "room.resumed") {
            expect(resumed.credentials.playerId).toBe(
                created.credentials.playerId,
            );
            expect(resumed.room.players[0]?.connectionStatus).toBe(
                "connected",
            );
        }
    });

    it("removes disconnected rooms after the reconnect grace", async () => {
        let nowMs = 1_000;
        const url = await startServer(() => nowMs);
        const host = await connect(url);
        await createRoom(host);
        expect(server?.getRoomCount()).toBe(1);

        host.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 20));
        nowMs += RECONNECT_GRACE_MS + 1;

        await waitUntil(() => server?.getRoomCount() === 0);
        expect(server?.getRoomCount()).toBe(0);
    });

    it("releases room quota when an asset is deleted", async () => {
        const rootDirectory = await mkdtemp(
            join(tmpdir(), "dance-vision-relay-delete-"),
        );
        roots.push(rootDirectory);

        let nextAsset = 0;

        const relay = new AssetRelayService({
            rootDirectory,
            roomQuotaBytes: 8,
            createAssetId: () =>
                `asset_${String(++nextAsset).padStart(16, "0")}`,
            createTicket: () =>
                `${nextAsset}`.padEnd(64, "t"),
        });

        await relay.start();

        const first = relay.reserveUpload(
            "room-1",
            "host-1",
            {
                kind: "artwork",
                mimeType: "image/png",
                byteLength: 8,
                sha256: `sha256:${"a".repeat(64)}`,
            },
        );

        expect(() =>
            relay.reserveUpload(
                "room-1",
                "host-1",
                {
                    kind: "artwork",
                    mimeType: "image/png",
                    byteLength: 1,
                    sha256: `sha256:${"b".repeat(64)}`,
                },
            ),
        ).toThrowError(AssetRelayError);

        await relay.deleteAsset(
            "room-1",
            first.asset.assetId,
        );

        expect(() =>
            relay.reserveUpload(
                "room-1",
                "host-1",
                {
                    kind: "artwork",
                    mimeType: "image/png",
                    byteLength: 1,
                    sha256: `sha256:${"b".repeat(64)}`,
                },
            ),
        ).not.toThrow();
    });
});
