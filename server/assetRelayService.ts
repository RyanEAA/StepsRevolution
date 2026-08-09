import {
    createHash,
    randomBytes,
    randomUUID,
} from "node:crypto";
import {
    createReadStream,
    createWriteStream,
} from "node:fs";
import {
    mkdir,
    readdir,
    rename,
    rm,
    stat,
} from "node:fs/promises";
import type {
    IncomingMessage,
    ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
    relayAssetSchema,
    relayAssetUploadProposalSchema,
} from "../shared/relaySchemas";
import type {
    RelayAsset,
    RelayAssetUploadProposal,
} from "../shared/relaySchemas";

const DEFAULT_TICKET_TTL_MS = 60_000;
const DEFAULT_ASSET_TTL_MS = 30 * 60_000;
const DEFAULT_ROOM_QUOTA_BYTES = 200 * 1024 * 1024;

interface AssetRecord {
    roomId: string;
    playerId: string;
    asset: RelayAsset;
    status: "reserved" | "ready";
    filePath: string | null;
}

interface RelayTicket {
    operation: "upload" | "download";
    assetId: string;
    roomId: string;
    playerId: string;
    expiresAtServerMs: number;
    consumed: boolean;
}

export interface AssetRelayServiceOptions {
    rootDirectory?: string;
    now?: () => number;
    createAssetId?: () => string;
    createTicket?: () => string;
    ticketTtlMs?: number;
    assetTtlMs?: number;
    roomQuotaBytes?: number;
    cleanupOnStart?: boolean;
}

export interface UploadGrant {
    asset: RelayAsset;
    uploadTicket: string;
    uploadPath: string;
    ticketExpiresAtServerMs: number;
}

export interface DownloadGrant {
    asset: RelayAsset;
    downloadTicket: string;
    downloadPath: string;
    ticketExpiresAtServerMs: number;
}

export class AssetRelayError extends Error {
    public readonly code:
        | "asset-not-found"
        | "asset-not-ready"
        | "asset-quota-exceeded"
        | "invalid-payload";
    public readonly statusCode: number;

    public constructor(
        code: AssetRelayError["code"],
        message: string,
        statusCode: number,
    ) {
        super(message);
        this.name = "AssetRelayError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

export class AssetRelayService {
    private readonly rootDirectory: string;
    private readonly now: () => number;
    private readonly createAssetId: () => string;
    private readonly createTicket: () => string;
    private readonly ticketTtlMs: number;
    private readonly assetTtlMs: number;
    private readonly roomQuotaBytes: number;
    private readonly cleanupOnStart: boolean;
    private readonly assets = new Map<string, AssetRecord>();
    private readonly tickets = new Map<string, RelayTicket>();

    public constructor(options: AssetRelayServiceOptions = {}) {
        this.rootDirectory = options.rootDirectory ??
            join(tmpdir(), "dance-vision-relay");
        this.now = options.now ?? Date.now;
        this.createAssetId = options.createAssetId ??
            (() => randomUUID());
        this.createTicket = options.createTicket ??
            (() => randomBytes(32).toString("hex"));
        this.ticketTtlMs = options.ticketTtlMs ??
            DEFAULT_TICKET_TTL_MS;
        this.assetTtlMs = options.assetTtlMs ??
            DEFAULT_ASSET_TTL_MS;
        this.roomQuotaBytes = options.roomQuotaBytes ??
            DEFAULT_ROOM_QUOTA_BYTES;
        this.cleanupOnStart = options.cleanupOnStart ?? true;
    }

    public async start(): Promise<void> {
        await mkdir(this.rootDirectory, { recursive: true });
        if (this.cleanupOnStart) {
            const entries = await readdir(this.rootDirectory);
            await Promise.all(entries.map((entry) =>
                rm(join(this.rootDirectory, entry), {
                    recursive: true,
                    force: true,
                }),
            ));
        }
    }

    public reserveUpload(
        roomId: string,
        playerId: string,
        rawProposal: RelayAssetUploadProposal,
    ): UploadGrant {
        const proposal = relayAssetUploadProposalSchema.parse(rawProposal);
        const roomBytes = [...this.assets.values()]
            .filter((record) => record.roomId === roomId)
            .reduce((total, record) =>
                total + record.asset.byteLength, 0);
        if (roomBytes + proposal.byteLength > this.roomQuotaBytes) {
            throw new AssetRelayError(
                "asset-quota-exceeded",
                "The room asset quota would be exceeded.",
                413,
            );
        }

        const assetId = this.createAssetId();
        const expiresAtServerMs = this.now() + this.assetTtlMs;
        const asset = relayAssetSchema.parse({
            ...proposal,
            assetId,
            expiresAtServerMs,
        });
        this.assets.set(assetId, {
            roomId,
            playerId,
            asset,
            status: "reserved",
            filePath: null,
        });

        const grant = this.createGrantTicket(
            "upload",
            roomId,
            playerId,
            assetId,
        );
        return {
            asset,
            uploadTicket: grant.ticket,
            uploadPath: `/relay/assets/${assetId}`,
            ticketExpiresAtServerMs: grant.expiresAtServerMs,
        };
    }

    public grantDownload(
        roomId: string,
        playerId: string,
        assetId: string,
    ): DownloadGrant {
        const record = this.assets.get(assetId);
        if (!record || record.roomId !== roomId) {
            throw new AssetRelayError(
                "asset-not-found",
                "The requested room asset does not exist.",
                404,
            );
        }
        if (record.status !== "ready" || !record.filePath) {
            throw new AssetRelayError(
                "asset-not-ready",
                "The requested room asset is not ready.",
                409,
            );
        }

        const grant = this.createGrantTicket(
            "download",
            roomId,
            playerId,
            assetId,
        );
        return {
            asset: record.asset,
            downloadTicket: grant.ticket,
            downloadPath: `/relay/assets/${assetId}`,
            ticketExpiresAtServerMs: grant.expiresAtServerMs,
        };
    }

    public async handleHttp(
        request: IncomingMessage,
        response: ServerResponse,
    ): Promise<boolean> {
        const match = request.url?.match(
            /^\/relay\/assets\/([A-Za-z0-9_-]{16,128})$/,
        );
        if (!match) return false;

        try {
            if (request.method === "PUT") {
                await this.handleUpload(request, response, match[1]!);
                return true;
            }
            if (request.method === "GET") {
                await this.handleDownload(request, response, match[1]!);
                return true;
            }
            this.json(response, 405, { error: "method-not-allowed" }, {
                allow: "PUT, GET",
            });
        } catch (error) {
            const relayError = error instanceof AssetRelayError
                ? error
                : new AssetRelayError(
                    "invalid-payload",
                    error instanceof Error
                        ? error.message
                        : "The asset transfer failed.",
                    400,
                );
            if (!response.headersSent) {
                this.json(response, relayError.statusCode, {
                    error: relayError.code,
                    message: relayError.message,
                });
            } else {
                response.destroy();
            }
        }
        return true;
    }

    public getReadyAsset(
        roomId: string,
        assetId: string,
    ): RelayAsset | null {
        const record = this.assets.get(assetId);
        return record?.roomId === roomId && record.status === "ready"
            ? record.asset
            : null;
    }

    public async deleteRoom(roomId: string): Promise<void> {
        const records = [...this.assets.entries()].filter(
            ([, record]) => record.roomId === roomId,
        );
        for (const [assetId] of records) this.assets.delete(assetId);
        for (const [ticket, value] of this.tickets) {
            if (value.roomId === roomId) this.tickets.delete(ticket);
        }
        if (records.length > 0) {
            await rm(this.roomDirectory(roomId), {
                recursive: true,
                force: true,
            });
        }
    }

    public async cleanupExpired(): Promise<void> {
        const nowMs = this.now();
        for (const [ticket, value] of this.tickets) {
            if (value.expiresAtServerMs <= nowMs || value.consumed) {
                this.tickets.delete(ticket);
            }
        }
        const expiredRooms = new Set<string>();
        for (const [assetId, record] of this.assets) {
            if (record.asset.expiresAtServerMs <= nowMs) {
                this.assets.delete(assetId);
                expiredRooms.add(record.roomId);
            }
        }
        for (const roomId of expiredRooms) {
            const hasRemaining = [...this.assets.values()].some(
                (record) => record.roomId === roomId,
            );
            if (!hasRemaining) {
                await rm(this.roomDirectory(roomId), {
                    recursive: true,
                    force: true,
                });
            }
        }
    }

    private async handleUpload(
        request: IncomingMessage,
        response: ServerResponse,
        assetId: string,
    ): Promise<void> {
        const ticket = this.authorize(request, "upload", assetId);
        const record = this.assets.get(assetId)!;
        const declaredLength = Number.parseInt(
            request.headers["content-length"] ?? "",
            10,
        );
        if (!Number.isInteger(declaredLength)) {
            throw new AssetRelayError(
                "invalid-payload",
                "Content-Length is required.",
                411,
            );
        }
        if (declaredLength !== record.asset.byteLength) {
            throw new AssetRelayError(
                "invalid-payload",
                "Content-Length does not match the asset reservation.",
                400,
            );
        }
        const contentType = request.headers["content-type"]?.split(";")[0];
        if (contentType !== record.asset.mimeType) {
            throw new AssetRelayError(
                "invalid-payload",
                "Content-Type does not match the asset reservation.",
                415,
            );
        }
        ticket.consumed = true;

        const roomDirectory = this.roomDirectory(record.roomId);
        await mkdir(roomDirectory, { recursive: true });
        const temporaryPath = join(
            roomDirectory,
            `${assetId}.${randomBytes(8).toString("hex")}.partial`,
        );
        const finalPath = join(roomDirectory, assetId);
        const hash = createHash("sha256");
        let received = 0;
        const verifier = new Transform({
            transform: (chunk: Buffer, _encoding, callback) => {
                received += chunk.length;
                if (received > record.asset.byteLength) {
                    callback(new Error("Upload exceeded its reserved size."));
                    return;
                }
                hash.update(chunk);
                callback(null, chunk);
            },
        });

        try {
            await pipeline(
                request,
                verifier,
                createWriteStream(temporaryPath, { flags: "wx" }),
            );
            if (received !== record.asset.byteLength) {
                throw new Error("Upload ended before the reserved size.");
            }
            const digest = `sha256:${hash.digest("hex")}`;
            if (digest !== record.asset.sha256) {
                throw new Error("Uploaded asset SHA-256 did not match.");
            }
            await rename(temporaryPath, finalPath);
            record.status = "ready";
            record.filePath = finalPath;
            this.json(response, 201, { asset: record.asset });
        } catch (error) {
            await rm(temporaryPath, { force: true });
            this.assets.delete(assetId);
            throw error;
        }
    }

    private async handleDownload(
        request: IncomingMessage,
        response: ServerResponse,
        assetId: string,
    ): Promise<void> {
        this.authorize(request, "download", assetId);
        const record = this.assets.get(assetId);
        if (!record || record.status !== "ready" || !record.filePath) {
            throw new AssetRelayError(
                "asset-not-ready",
                "The requested room asset is not ready.",
                409,
            );
        }
        const file = await stat(record.filePath);
        const range = this.parseRange(request.headers.range, file.size);
        response.writeHead(range ? 206 : 200, {
            "content-type": record.asset.mimeType,
            "content-length": range
                ? range.end - range.start + 1
                : file.size,
            "accept-ranges": "bytes",
            "cache-control": "private, no-store",
            ...(range ? {
                "content-range":
                    `bytes ${range.start}-${range.end}/${file.size}`,
            } : {}),
        });
        await pipeline(
            createReadStream(record.filePath, range ?? undefined),
            response,
        );
    }

    private authorize(
        request: IncomingMessage,
        operation: RelayTicket["operation"],
        assetId: string,
    ): RelayTicket {
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith("Bearer ")
            ? authorization.slice(7)
            : "";
        const ticket = this.tickets.get(token);
        if (!ticket || ticket.operation !== operation ||
            ticket.assetId !== assetId || ticket.consumed ||
            ticket.expiresAtServerMs <= this.now()) {
            throw new AssetRelayError(
                "invalid-payload",
                "The asset transfer ticket is invalid or expired.",
                401,
            );
        }
        return ticket;
    }

    private createGrantTicket(
        operation: RelayTicket["operation"],
        roomId: string,
        playerId: string,
        assetId: string,
    ): { ticket: string; expiresAtServerMs: number } {
        const ticket = this.createTicket();
        const expiresAtServerMs = this.now() + this.ticketTtlMs;
        this.tickets.set(ticket, {
            operation,
            roomId,
            playerId,
            assetId,
            expiresAtServerMs,
            consumed: false,
        });
        return { ticket, expiresAtServerMs };
    }

    private roomDirectory(roomId: string): string {
        const safeRoomKey = createHash("sha256")
            .update(roomId)
            .digest("hex");
        return join(this.rootDirectory, safeRoomKey);
    }

    private parseRange(
        header: string | undefined,
        fileSize: number,
    ): { start: number; end: number } | null {
        if (!header) return null;
        const match = header.match(/^bytes=(\d+)-(\d*)$/);
        if (!match) {
            throw new AssetRelayError(
                "invalid-payload",
                "Only one explicit byte range is supported.",
                416,
            );
        }
        const start = Number.parseInt(match[1]!, 10);
        const end = match[2]
            ? Number.parseInt(match[2], 10)
            : fileSize - 1;
        if (start < 0 || end < start || end >= fileSize) {
            throw new AssetRelayError(
                "invalid-payload",
                "The requested byte range is unsatisfiable.",
                416,
            );
        }
        return { start, end };
    }

    private json(
        response: ServerResponse,
        statusCode: number,
        body: object,
        headers: Record<string, string> = {},
    ): void {
        response.writeHead(statusCode, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...headers,
        });
        response.end(JSON.stringify(body));
    }
}
