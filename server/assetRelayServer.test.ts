import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";

import { CHART_IDENTITY_VERSION, PROTOCOL_VERSION } from "../shared/constants";
import { ASSET_PROTOCOL_VERSION } from "../shared/relaySchemas";
import { serverMessageSchema } from "../shared/schemas";
import type {
    ClientCommand,
    ServerMessage,
} from "../shared/schemas";
import { DanceVisionServer } from "./createDanceVisionServer";

let server: DanceVisionServer | null = null;
const clients: Socket[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    await server?.stop();
    server = null;
    for (const directory of temporaryDirectories.splice(0)) {
        await rm(directory, { recursive: true, force: true });
    }
});

async function startServer(roomQuotaBytes?: number): Promise<string> {
    const rootDirectory = await mkdtemp(
        join(tmpdir(), "dance-vision-relay-test-"),
    );
    temporaryDirectories.push(rootDirectory);
    server = new DanceVisionServer({
        port: 0,
        assetRelayOptions: {
            rootDirectory,
            roomQuotaBytes,
        },
    });
    return server.start();
}

async function connect(url: string): Promise<Socket> {
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
    client: Socket,
    command: ClientCommand,
): Promise<ServerMessage> {
    return new Promise((resolve) => {
        client.emit("command", command, (raw: unknown) => {
            resolve(serverMessageSchema.parse(raw));
        });
    });
}

async function createRoom(client: Socket) {
    const response = await send(client, {
        protocolVersion: PROTOCOL_VERSION,
        type: "room.create",
        commandId: "create-room",
        payload: { displayName: "Host" },
    });
    if (response.type !== "room.created") {
        throw new Error("Expected room.created.");
    }
    return response;
}

function digest(bytes: Uint8Array): string {
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function uploadAsset(
    url: string,
    host: Socket,
    roomId: string,
    kind: "song-audio" | "chart-package",
    mimeType: string,
    bytes: Uint8Array,
) {
    const grant = await send(host, {
        protocolVersion: PROTOCOL_VERSION,
        type: "asset.upload.request",
        commandId: `upload-${kind}`,
        roomId,
        payload: { asset: { kind, mimeType, byteLength: bytes.byteLength, sha256: digest(bytes) } },
    });
    if (grant.type !== "asset.upload.granted") throw new Error("Expected upload grant.");
    const response = await fetch(`${url}${grant.uploadPath}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${grant.uploadTicket}`, "content-type": mimeType,
            "content-length": bytes.byteLength.toString() },
        body: Buffer.from(bytes),
    });
    expect(response.status).toBe(201);
    return grant.asset;
}

describe("temporary asset relay", () => {
    it("commits only fully uploaded song and chart assets", async () => {
        const url = await startServer();
        const host = await connect(url);
        const guest = await connect(url);
        const created = await createRoom(host);
        const joined = await send(guest, {
            protocolVersion: PROTOCOL_VERSION, type: "room.join", commandId: "join-package-room",
            payload: { roomCode: created.room.roomCode, displayName: "Guest" },
        });
        if (joined.type !== "room.joined") throw new Error("Expected room.joined.");
        const audio = await uploadAsset(url, host, created.room.roomId, "song-audio", "audio/ogg",
            new TextEncoder().encode("audio bytes"));
        const chartPackage = await uploadAsset(url, host, created.room.roomId, "chart-package", "application/json",
            new TextEncoder().encode("{\"charts\":[]}"));
        if (audio.kind !== "song-audio" || chartPackage.kind !== "chart-package") throw new Error("Wrong asset kinds.");
        const committed = await send(host, {
            protocolVersion: PROTOCOL_VERSION, type: "songPackage.commit", commandId: "commit-song",
            roomId: created.room.roomId, expectedRoomRevision: joined.room.revision,
            payload: { songPackage: {
                assetProtocolVersion: ASSET_PROTOCOL_VERSION, packageId: "package-1", songId: "song-1",
                title: "Song", subtitle: "", artist: "Artist", artwork: null, audio, chartPackage,
                charts: [{ chartId: "chart-1", chartHash: `${CHART_IDENTITY_VERSION}:${"a".repeat(64)}`,
                    stepType: "dance-single", description: "", difficulty: "Hard", meter: 8,
                    tapCount: 100, durationSeconds: 90 }],
            } },
        });
        expect(committed).toMatchObject({ type: "command.accepted", roomRevision: joined.room.revision + 1 });
    });

    it("streams a verified host upload and authorized guest download", async () => {
        const url = await startServer();
        const host = await connect(url);
        const guest = await connect(url);
        const created = await createRoom(host);
        const joined = await send(guest, {
            protocolVersion: PROTOCOL_VERSION,
            type: "room.join",
            commandId: "join-room",
            payload: {
                roomCode: created.room.roomCode,
                displayName: "Guest",
            },
        });
        expect(joined.type).toBe("room.joined");

        const bytes = new TextEncoder().encode("preview bytes");
        const upload = await send(host, {
            protocolVersion: PROTOCOL_VERSION,
            type: "asset.upload.request",
            commandId: "reserve-upload",
            roomId: created.room.roomId,
            payload: {
                asset: {
                    kind: "preview-audio",
                    mimeType: "audio/wav",
                    byteLength: bytes.byteLength,
                    sha256: digest(bytes),
                },
            },
        });
        expect(upload.type).toBe("asset.upload.granted");
        if (upload.type !== "asset.upload.granted") {
            throw new Error("Expected upload grant.");
        }

        const put = await fetch(`${url}${upload.uploadPath}`, {
            method: "PUT",
            headers: {
                authorization: `Bearer ${upload.uploadTicket}`,
                "content-type": "audio/wav",
                "content-length": bytes.byteLength.toString(),
            },
            body: bytes,
        });
        expect(put.status).toBe(201);

        const download = await send(guest, {
            protocolVersion: PROTOCOL_VERSION,
            type: "asset.download.request",
            commandId: "grant-download",
            roomId: created.room.roomId,
            payload: { assetId: upload.asset.assetId },
        });
        expect(download.type).toBe("asset.download.granted");
        if (download.type !== "asset.download.granted") {
            throw new Error("Expected download grant.");
        }

        const get = await fetch(`${url}${download.downloadPath}`, {
            headers: {
                authorization: `Bearer ${download.downloadTicket}`,
            },
        });
        expect(get.status).toBe(200);
        expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes);

        const range = await fetch(`${url}${download.downloadPath}`, {
            headers: {
                authorization: `Bearer ${download.downloadTicket}`,
                range: "bytes=0-6",
            },
        });
        expect(range.status).toBe(206);
        expect(range.headers.get("content-range"))
            .toBe(`bytes 0-6/${bytes.byteLength}`);
    });

    it("restricts upload reservations to the host", async () => {
        const url = await startServer();
        const host = await connect(url);
        const guest = await connect(url);
        const created = await createRoom(host);
        await send(guest, {
            protocolVersion: PROTOCOL_VERSION,
            type: "room.join",
            commandId: "join-room",
            payload: {
                roomCode: created.room.roomCode,
                displayName: "Guest",
            },
        });
        const bytes = new TextEncoder().encode("art");

        const response = await send(guest, {
            protocolVersion: PROTOCOL_VERSION,
            type: "asset.upload.request",
            commandId: "guest-upload",
            roomId: created.room.roomId,
            payload: {
                asset: {
                    kind: "artwork",
                    mimeType: "image/png",
                    byteLength: bytes.byteLength,
                    sha256: digest(bytes),
                },
            },
        });
        expect(response).toMatchObject({
            type: "command.rejected",
            code: "not-host",
        });
    });

    it("rejects hash mismatches and enforces the room quota", async () => {
        const url = await startServer(8);
        const host = await connect(url);
        const created = await createRoom(host);
        const bytes = new TextEncoder().encode("1234");
        const upload = await send(host, {
            protocolVersion: PROTOCOL_VERSION,
            type: "asset.upload.request",
            commandId: "bad-hash-upload",
            roomId: created.room.roomId,
            payload: {
                asset: {
                    kind: "artwork",
                    mimeType: "image/png",
                    byteLength: bytes.byteLength,
                    sha256: `sha256:${"0".repeat(64)}`,
                },
            },
        });
        if (upload.type !== "asset.upload.granted") {
            throw new Error("Expected upload grant.");
        }
        const put = await fetch(`${url}${upload.uploadPath}`, {
            method: "PUT",
            headers: {
                authorization: `Bearer ${upload.uploadTicket}`,
                "content-type": "image/png",
                "content-length": bytes.byteLength.toString(),
            },
            body: bytes,
        });
        expect(put.status).toBe(400);

        const tooLarge = new Uint8Array(9);
        const quota = await send(host, {
            protocolVersion: PROTOCOL_VERSION,
            type: "asset.upload.request",
            commandId: "quota-upload",
            roomId: created.room.roomId,
            payload: {
                asset: {
                    kind: "artwork",
                    mimeType: "image/png",
                    byteLength: tooLarge.byteLength,
                    sha256: digest(tooLarge),
                },
            },
        });
        expect(quota).toMatchObject({
            type: "command.rejected",
            code: "asset-quota-exceeded",
        });
    });

    it("revokes asset tickets when the room closes", async () => {
        const url = await startServer();
        const host = await connect(url);
        const created = await createRoom(host);
        const bytes = new TextEncoder().encode("image");
        const upload = await send(host, {
            protocolVersion: PROTOCOL_VERSION,
            type: "asset.upload.request",
            commandId: "upload",
            roomId: created.room.roomId,
            payload: {
                asset: {
                    kind: "artwork",
                    mimeType: "image/png",
                    byteLength: bytes.byteLength,
                    sha256: digest(bytes),
                },
            },
        });
        if (upload.type !== "asset.upload.granted") {
            throw new Error("Expected upload grant.");
        }
        await fetch(`${url}${upload.uploadPath}`, {
            method: "PUT",
            headers: {
                authorization: `Bearer ${upload.uploadTicket}`,
                "content-type": "image/png",
                "content-length": bytes.byteLength.toString(),
            },
            body: bytes,
        });
        const download = await send(host, {
            protocolVersion: PROTOCOL_VERSION,
            type: "asset.download.request",
            commandId: "download",
            roomId: created.room.roomId,
            payload: { assetId: upload.asset.assetId },
        });
        if (download.type !== "asset.download.granted") {
            throw new Error("Expected download grant.");
        }

        await send(host, {
            protocolVersion: PROTOCOL_VERSION,
            type: "room.close",
            commandId: "close",
            roomId: created.room.roomId,
            expectedRoomRevision: created.room.revision,
            payload: {},
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        const get = await fetch(`${url}${download.downloadPath}`, {
            headers: {
                authorization: `Bearer ${download.downloadTicket}`,
            },
        });
        expect(get.status).toBe(401);
    });
});
