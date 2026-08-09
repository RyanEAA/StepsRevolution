import type { RelayAsset, RelayAssetKind } from "../../shared/relaySchemas";
import type { RoomSession } from "./RoomSession";

export class RelayAssetClient {
    private readonly serverUrl: string;
    private readonly session: RoomSession;

    public constructor(
        serverUrl: string,
        session: RoomSession,
    ) {
        this.serverUrl = serverUrl;
        this.session = session;
    }

    public async upload(kind: RelayAssetKind, blob: Blob, mimeType: string, signal?: AbortSignal): Promise<RelayAsset> {
        const sha256 = await hashBlob(blob);
        const grant = await this.session.requestAssetUpload({
            kind,
            mimeType,
            byteLength: blob.size,
            sha256,
        });
        const response = await fetch(this.resolve(grant.uploadPath), {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${grant.uploadTicket}`,
                "Content-Type": mimeType,
            },
            body: blob,
            signal,
        });
        if (!response.ok) throw new Error(`Preview upload failed (${response.status}).`);
        return grant.asset;
    }

    public async download(asset: RelayAsset, signal?: AbortSignal): Promise<Blob> {
        const grant = await this.session.requestAssetDownload(asset.assetId);
        const response = await fetch(this.resolve(grant.downloadPath), {
            headers: { Authorization: `Bearer ${grant.downloadTicket}` },
            signal,
        });
        if (!response.ok) throw new Error(`Preview download failed (${response.status}).`);
        const blob = await response.blob();
        if (blob.size !== asset.byteLength || await hashBlob(blob) !== asset.sha256) {
            throw new Error("The downloaded preview failed its integrity check.");
        }
        return blob;
    }

    private resolve(path: string): string {
        return new URL(path, this.serverUrl).toString();
    }
}

async function hashBlob(blob: Blob): Promise<`sha256:${string}`> {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `sha256:${hex}`;
}
