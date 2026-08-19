import {
    createServer as createHttpServer,
} from "node:http";
import type { AddressInfo } from "node:net";

import { Server as SocketIoServer } from "socket.io";
import type { Socket } from "socket.io";

import { PROTOCOL_VERSION } from "../shared/constants";
import {
    clientCommandSchema,
} from "../shared/schemas";

import {
    AssetRelayError,
    AssetRelayService,
} from "./assetRelayService";
import type { AssetRelayServiceOptions } from "./assetRelayService";
import { RoomRegistry } from "./roomRegistry";
import type {
    RegistryEffect,
    RegistryResult,
    RoomRegistryOptions,
} from "./roomRegistry";

import type {
    ClientCommand,
    RoomState,
    ServerMessage,
} from "../shared/schemas";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
    extname,
    resolve,
    sep,
} from "node:path";

interface ClientToServerEvents {
    command: (
        rawCommand: unknown,
        acknowledge: (message: ServerMessage) => void,
    ) => void;
}

interface ServerToClientEvents {
    message: (message: ServerMessage) => void;
}

interface InterServerEvents {
    ping: () => void;
}

interface SocketData { }

type DanceVisionSocket = Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

export interface DanceVisionServerOptions {
    port?: number;
    host?: string;
    allowedOrigins?: string[];
    tickIntervalMs?: number;
    registryOptions?: RoomRegistryOptions;
    assetRelayOptions?: AssetRelayServiceOptions;
}

export class DanceVisionServer {
    private readonly port: number;
    private readonly host: string;
    private readonly tickIntervalMs: number;
    private readonly registry: RoomRegistry;
    private readonly assetRelay: AssetRelayService;
    private readonly allowedOrigins: string[];
    private readonly httpServer;
    private readonly io;
    private readonly staticRoot: string;

    private tickTimer: ReturnType<typeof setInterval> | null = null;
    private relayCleanupTimer: ReturnType<typeof setInterval> | null = null;

    public constructor(options: DanceVisionServerOptions = {}) {
        this.port = options.port ?? 3001;
        this.host = options.host ?? "127.0.0.1";
        this.tickIntervalMs = options.tickIntervalMs ?? 250;
        this.registry = new RoomRegistry(options.registryOptions);
        this.assetRelay = new AssetRelayService(options.assetRelayOptions);
        this.staticRoot = resolve(process.cwd(), "dist"); this.allowedOrigins = options.allowedOrigins ?? [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ];

        this.httpServer = createHttpServer((request, response) => {
            void this.handleHttpRequest(request, response);
        });

        this.io = new SocketIoServer<
            ClientToServerEvents,
            ServerToClientEvents,
            InterServerEvents,
            SocketData
        >(this.httpServer, {
            cors: {
                origin: this.allowedOrigins,
                methods: ["GET", "POST"],
            },
        });

        this.io.on("connection", (socket) => {
            this.configureSocket(socket);
        });
    }

    private async handleHttpRequest(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): Promise<void> {
        const origin = request.headers.origin;
        if (origin && this.allowedOrigins.includes(origin)) {
            response.setHeader("access-control-allow-origin", origin);
            response.setHeader("vary", "Origin");
            response.setHeader(
                "access-control-allow-headers",
                "Authorization, Content-Type, Content-Length, Range",
            );
            response.setHeader(
                "access-control-expose-headers",
                "Content-Length, Content-Range, Accept-Ranges",
            );
        }
        if (request.method === "OPTIONS" &&
            request.url?.startsWith("/relay/assets/")) {
            response.writeHead(204, {
                "access-control-allow-methods": "PUT, GET, OPTIONS",
                "cache-control": "no-store",
            });
            response.end();
            return;
        }

        if (await this.assetRelay.handleHttp(request, response)) {
            return;
        }

        if (request.method === "GET" && request.url === "/health") {
            response.writeHead(200, {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
            });

            response.end(JSON.stringify({
                status: "ok",
                protocolVersion: PROTOCOL_VERSION,
                rooms: this.registry.getRoomCount(),
            }));

            return;
        }

        if (
            request.method === "GET" ||
            request.method === "HEAD"
        ) {
            if (await this.handleStaticRequest(request, response)) {
                return;
            }
        }

        response.writeHead(404, {
            "content-type": "application/json; charset=utf-8",
        });

        response.end(JSON.stringify({
            error: "not-found",
        }));
    }

    private async handleStaticRequest(
        request: import("node:http").IncomingMessage,
        response: import("node:http").ServerResponse,
    ): Promise<boolean> {
        const requestUrl = request.url ?? "/";

        if (requestUrl.startsWith("/socket.io/")) {
            return false;
        }

        let pathname: string;

        try {
            pathname = decodeURIComponent(
                new URL(requestUrl, "http://localhost").pathname,
            );
        } catch {
            return false;
        }

        const relativePath =
            pathname === "/"
                ? "index.html"
                : pathname.replace(/^\/+/, "");

        const requestedPath = resolve(
            this.staticRoot,
            relativePath,
        );

        if (
            requestedPath !== this.staticRoot &&
            !requestedPath.startsWith(
                `${this.staticRoot}${sep}`,
            )
        ) {
            return false;
        }

        const staticRootPrefix = `${this.staticRoot}${sep}`;

        if (
            requestedPath !== this.staticRoot &&
            !requestedPath.startsWith(staticRootPrefix)
        ) {
            return false;
        }

        if (await this.tryServeFile(
            requestedPath,
            request.method === "HEAD",
            response,
        )) {
            return true;
        }

        // Vite is a single-page application. Unknown browser routes
        // fall back to index.html so client-side navigation still works.
        const indexPath = resolve(
            this.staticRoot,
            "index.html",
        );

        return this.tryServeFile(
            indexPath,
            request.method === "HEAD",
            response,
        );
    }

    private async tryServeFile(
        filePath: string,
        headOnly: boolean,
        response: import("node:http").ServerResponse,
    ): Promise<boolean> {
        let fileStats;

        try {
            fileStats = await stat(filePath);
        } catch {
            return false;
        }

        if (!fileStats.isFile()) {
            return false;
        }

        const isViteAsset =
            filePath.startsWith(
                `${resolve(this.staticRoot, "assets")}${sep}`,
            );

        response.writeHead(200, {
            "content-type": this.contentTypeFor(filePath),
            "content-length": fileStats.size,
            "cache-control": isViteAsset
                ? "public, max-age=31536000, immutable"
                : "no-cache",
        });

        if (headOnly) {
            response.end();
            return true;
        }

        const stream = createReadStream(filePath);

        stream.on("error", () => {
            if (!response.headersSent) {
                response.writeHead(500);
            }

            response.end();
        });

        stream.pipe(response);

        return true;
    }

    private contentTypeFor(filePath: string): string {
        switch (extname(filePath).toLowerCase()) {
            case ".html":
                return "text/html; charset=utf-8";
            case ".js":
                return "text/javascript; charset=utf-8";
            case ".css":
                return "text/css; charset=utf-8";
            case ".json":
                return "application/json; charset=utf-8";
            case ".svg":
                return "image/svg+xml";
            case ".png":
                return "image/png";
            case ".jpg":
            case ".jpeg":
                return "image/jpeg";
            case ".webp":
                return "image/webp";
            case ".ico":
                return "image/x-icon";
            case ".woff":
                return "font/woff";
            case ".woff2":
                return "font/woff2";
            case ".wasm":
                return "application/wasm";
            case ".mp3":
                return "audio/mpeg";
            case ".ogg":
                return "audio/ogg";
            case ".wav":
                return "audio/wav";
            default:
                return "application/octet-stream";
        }
    }

    private referencedAssetIds(
        room: RoomState | null,
    ): Set<string> {
        const assetIds = new Set<string>();

        if (!room) {
            return assetIds;
        }

        if (room.preview?.artwork) {
            assetIds.add(room.preview.artwork.assetId);
        }

        if (room.preview?.audioPreview) {
            assetIds.add(room.preview.audioPreview.assetId);
        }

        if (room.songPackage?.artwork) {
            assetIds.add(room.songPackage.artwork.assetId);
        }

        if (room.songPackage) {
            assetIds.add(room.songPackage.audio.assetId);
            assetIds.add(room.songPackage.chartPackage.assetId);
        }

        return assetIds;
    }

    public async start(): Promise<string> {
        if (this.httpServer.listening) {
            return this.getUrl();
        }

        await this.assetRelay.start();
        await new Promise<void>((resolve, reject) => {
            const handleError = (error: Error) => {
                this.httpServer.off("listening", handleListening);
                reject(error);
            };
            const handleListening = () => {
                this.httpServer.off("error", handleError);
                resolve();
            };

            this.httpServer.once("error", handleError);
            this.httpServer.once("listening", handleListening);
            this.httpServer.listen(this.port, this.host);
        });

        this.tickTimer = setInterval(() => {
            this.publishEffects(this.registry.tick());
        }, this.tickIntervalMs);
        this.tickTimer.unref?.();
        this.relayCleanupTimer = setInterval(() => {
            void this.assetRelay.cleanupExpired();
        }, 30_000);
        this.relayCleanupTimer.unref?.();

        return this.getUrl();
    }

    public async stop(): Promise<void> {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        if (this.relayCleanupTimer) {
            clearInterval(this.relayCleanupTimer);
            this.relayCleanupTimer = null;
        }

        await new Promise<void>((resolve) => {
            this.io.close(() => resolve());
        });
    }

    public getRoomCount(): number {
        return this.registry.getRoomCount();
    }

    private configureSocket(socket: DanceVisionSocket): void {
        socket.on("command", (rawCommand, acknowledge) => {
            if (typeof acknowledge !== "function") {
                return;
            }

            void this.handleCommand(
                socket,
                rawCommand,
                acknowledge,
            ).catch(() => {
                acknowledge({
                    protocolVersion: PROTOCOL_VERSION,
                    type: "server.error",
                    code: "internal-server-error",
                    message: "The server could not process the command.",
                });
            });
        });

        socket.on("disconnect", () => {
            this.publishEffects(
                this.registry.disconnect(socket.id),
            );
        });
    }

    private async handleCommand(
        socket: DanceVisionSocket,
        rawCommand: unknown,
        acknowledge: (message: ServerMessage) => void,
    ): Promise<void> {
        const receivedAtMs = Date.now();
        const parsed = clientCommandSchema.safeParse(rawCommand);

        if (!parsed.success) {
            acknowledge(this.invalidCommandResponse(rawCommand));
            return;
        }

        const command = parsed.data;
        let result: RegistryResult;

        switch (command.type) {
            case "room.create":
                result = this.registry.createRoom(socket.id, command);
                break;
            case "room.join":
                result = this.registry.joinRoom(socket.id, command);
                break;
            case "room.resume":
                result = this.registry.resumeRoom(socket.id, command);
                break;
            case "clock.ping":
                result = this.registry.handleClockPing(
                    socket.id,
                    command,
                    receivedAtMs,
                );
                break;
            case "asset.upload.request":
            case "asset.download.request":
                acknowledge(this.handleAssetCommand(socket, command));
                return;
            default:
                if (command.type === "preview.publish") {
                    const rejection = this.validatePreviewAssets(socket, command);
                    if (rejection) {
                        acknowledge(rejection);
                        return;
                    }
                }
                if (command.type === "songPackage.commit") {
                    const rejection = this.validateSongPackageAssets(socket, command);
                    if (rejection) { acknowledge(rejection); return; }
                }

                const previousRoom = this.registry.getRoomState(
                    command.roomId,
                );

                const previousAssetIds =
                    this.referencedAssetIds(previousRoom);

                result = this.registry.handleMemberCommand(
                    socket.id,
                    command,
                );

                if (result.response.type === "command.accepted") {
                    const currentRoom = this.registry.getRoomState(
                        command.roomId,
                    );

                    const currentAssetIds =
                        this.referencedAssetIds(currentRoom);

                    for (const assetId of previousAssetIds) {
                        if (!currentAssetIds.has(assetId)) {
                            void this.assetRelay.deleteAsset(
                                command.roomId,
                                assetId,
                            );
                        }
                    }
                }
                break;
        }

        if (result.joinedRoomId) {
            await socket.join(result.joinedRoomId);
        }

        if (result.leftRoomId) {
            await socket.leave(result.leftRoomId);
        }

        if (result.kickedSocketId && result.kickedRoomId) {
            const kickedSocket = this.io.sockets.sockets.get(result.kickedSocketId);
            if (kickedSocket) {
                kickedSocket.emit("message", {
                    protocolVersion: PROTOCOL_VERSION,
                    type: "room.closed",
                    roomId: result.kickedRoomId,
                    reason: "kicked",
                    message: "The host removed you from the room.",
                });
                await kickedSocket.leave(result.kickedRoomId);
            }
        }

        acknowledge(result.response);
        this.publishEffects(result.effects);
    }

    private validatePreviewAssets(
        socket: DanceVisionSocket,
        command: Extract<ClientCommand, { type: "preview.publish" }>,
    ): ServerMessage | null {
        const context = this.registry.getMemberContext(socket.id, command.roomId);
        if (!context) {
            return this.assetRejection(command.commandId, "not-a-member", "Join the room before publishing a preview.", null);
        }
        if (!context.isHost) {
            return this.assetRejection(command.commandId, "not-host", "Only the host can publish song previews.", context.roomRevision);
        }
        const assets = [command.payload.preview.artwork, command.payload.preview.audioPreview]
            .filter((asset): asset is NonNullable<typeof asset> => asset !== null);
        const allReady = assets.every((asset) => {
            const ready = this.assetRelay.getReadyAsset(command.roomId, asset.assetId);
            return ready !== null && JSON.stringify(ready) === JSON.stringify(asset);
        });
        return allReady ? null : this.assetRejection(
            command.commandId,
            "asset-not-ready",
            "Every preview asset must be fully uploaded to this room before publication.",
            context.roomRevision,
        );
    }

    private validateSongPackageAssets(
        socket: DanceVisionSocket,
        command: Extract<ClientCommand, { type: "songPackage.commit" }>,
    ): ServerMessage | null {
        const context = this.registry.getMemberContext(socket.id, command.roomId);
        if (!context) return this.assetRejection(command.commandId, "not-a-member", "Join the room before confirming a song.", null);
        if (!context.isHost) return this.assetRejection(command.commandId, "not-host", "Only the host can confirm the room song.", context.roomRevision);
        const descriptors = [command.payload.songPackage.audio, command.payload.songPackage.chartPackage,
        ...(command.payload.songPackage.artwork ? [command.payload.songPackage.artwork] : [])];
        const allReady = descriptors.every((asset) => {
            const ready = this.assetRelay.getReadyAsset(command.roomId, asset.assetId);
            return ready !== null && JSON.stringify(ready) === JSON.stringify(asset);
        });
        return allReady ? null : this.assetRejection(command.commandId, "asset-not-ready",
            "The song audio, charts, and artwork must finish uploading before confirmation.", context.roomRevision);
    }

    private handleAssetCommand(
        socket: DanceVisionSocket,
        command: Extract<
            ClientCommand,
            { type: "asset.upload.request" | "asset.download.request" }
        >,
    ): ServerMessage {
        const context = this.registry.getMemberContext(
            socket.id,
            command.roomId,
        );
        if (!context) {
            return this.assetRejection(
                command.commandId,
                "not-a-member",
                "Join the room before requesting asset transfer.",
                null,
            );
        }
        if (command.type === "asset.upload.request" && !context.isHost) {
            return this.assetRejection(
                command.commandId,
                "not-host",
                "Only the room host can upload song assets.",
                context.roomRevision,
            );
        }

        try {
            if (command.type === "asset.upload.request") {
                const grant = this.assetRelay.reserveUpload(
                    context.roomId,
                    context.playerId,
                    command.payload.asset,
                );
                return {
                    protocolVersion: PROTOCOL_VERSION,
                    type: "asset.upload.granted",
                    commandId: command.commandId,
                    ...grant,
                };
            }
            const grant = this.assetRelay.grantDownload(
                context.roomId,
                context.playerId,
                command.payload.assetId,
            );
            return {
                protocolVersion: PROTOCOL_VERSION,
                type: "asset.download.granted",
                commandId: command.commandId,
                ...grant,
            };
        } catch (error) {
            const relayError = error instanceof AssetRelayError
                ? error
                : new AssetRelayError(
                    "invalid-payload",
                    "The asset request is invalid.",
                    400,
                );
            return this.assetRejection(
                command.commandId,
                relayError.code,
                relayError.message,
                context.roomRevision,
            );
        }
    }

    private assetRejection(
        commandId: string,
        code: import("../shared/schemas").RejectionCode,
        message: string,
        roomRevision: number | null,
    ): ServerMessage {
        return {
            protocolVersion: PROTOCOL_VERSION,
            type: "command.rejected",
            commandId,
            code,
            message,
            roomRevision,
        };
    }

    private invalidCommandResponse(rawCommand: unknown): ServerMessage {
        const record = this.asRecord(rawCommand);
        const protocolVersion = record?.protocolVersion;
        const commandId =
            typeof record?.commandId === "string" &&
                record.commandId.length > 0
                ? record.commandId
                : "unknown-command";

        return {
            protocolVersion: PROTOCOL_VERSION,
            type: "command.rejected",
            commandId,
            code:
                protocolVersion !== undefined &&
                    protocolVersion !== PROTOCOL_VERSION
                    ? "protocol-version-mismatch"
                    : "invalid-payload",
            message:
                protocolVersion !== undefined &&
                    protocolVersion !== PROTOCOL_VERSION
                    ? "The client protocol version is unsupported."
                    : "The command payload is invalid.",
            roomRevision: null,
        };
    }

    private publishEffects(effects: readonly RegistryEffect[]): void {
        for (const effect of effects) {
            this.io.to(effect.roomId).emit(
                "message",
                effect.message,
            );

            if (effect.closeRoom) {
                this.io.in(effect.roomId).socketsLeave(effect.roomId);
                void this.assetRelay.deleteRoom(effect.roomId);
            }
        }
    }

    private getUrl(): string {
        const address = this.httpServer.address();

        if (!address || typeof address === "string") {
            throw new Error("The room server is not listening.");
        }

        return `http://${this.host}:${(address as AddressInfo).port}`;
    }

    private asRecord(value: unknown): Record<string, unknown> | null {
        return typeof value === "object" && value !== null
            ? value as Record<string, unknown>
            : null;
    }
}
