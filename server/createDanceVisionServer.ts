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
import type { ServerMessage } from "../shared/schemas";
import type { ClientCommand } from "../shared/schemas";
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

interface SocketData {}

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

    private tickTimer: ReturnType<typeof setInterval> | null = null;
    private relayCleanupTimer: ReturnType<typeof setInterval> | null = null;

    public constructor(options: DanceVisionServerOptions = {}) {
        this.port = options.port ?? 3001;
        this.host = options.host ?? "127.0.0.1";
        this.tickIntervalMs = options.tickIntervalMs ?? 250;
        this.registry = new RoomRegistry(options.registryOptions);
        this.assetRelay = new AssetRelayService(options.assetRelayOptions);
        this.allowedOrigins = options.allowedOrigins ?? [
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

        response.writeHead(404, {
            "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "not-found" }));
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
                result = this.registry.handleMemberCommand(
                    socket.id,
                    command,
                );
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
