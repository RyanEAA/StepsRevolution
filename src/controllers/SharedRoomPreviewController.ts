import { ASSET_PROTOCOL_VERSION } from "../../shared/relaySchemas";
import type { RelayAsset, RoomPreview } from "../../shared/relaySchemas";
import { AudioPreviewClipBuilder } from "../audio/AudioPreviewClipBuilder";
import type { SongEntry } from "../types/Library";
import type { RoomPreviewView } from "../ui/RoomPreviewView";
import type { RelayAssetClient } from "../multiplayer/RelayAssetClient";
import type { RoomSession, RoomSessionState } from "../multiplayer/RoomSession";

export class SharedRoomPreviewController {
    private readonly session: RoomSession;
    private readonly relay: RelayAssetClient;
    private readonly view: RoomPreviewView;
    private readonly clipBuilder = new AudioPreviewClipBuilder();
    private unsubscribe: (() => void) | null = null;
    private operation = 0;
    private abort: AbortController | null = null;
    private shownRevision = 0;
    private artworkUrl: string | null = null;
    private audioUrl: string | null = null;

    public constructor(
        session: RoomSession,
        relay: RelayAssetClient,
        view: RoomPreviewView,
    ) {
        this.session = session;
        this.relay = relay;
        this.view = view;
    }

    public initialize(): void {
        this.view.initialize();
        this.unsubscribe = this.session.subscribe((state) => this.handleState(state));
    }

    public async publishSong(song: SongEntry): Promise<void> {
        const state = this.session.getState();
        if (!state.room || state.room.hostPlayerId !== state.localPlayerId || !song.audioFile) return;
        const identity = song.chartIdentities.find((record) => record.state === "available");
        if (!identity || identity.state !== "available") return;
        const operation = this.beginOperation();
        const signal = this.abort!.signal;
        const start = song.simfile.sampleStartSeconds > 0 ? song.simfile.sampleStartSeconds : 20;
        const duration = song.simfile.sampleLengthSeconds > 0 ? Math.min(song.simfile.sampleLengthSeconds, 15) : 12;
        try {
            const artworkFile = song.bannerFile ?? song.backgroundFile;
            const [audioPreview, artwork] = await Promise.all([
                this.clipBuilder.build(song.audioFile, start, duration)
                    .then((blob) => this.relay.upload("preview-audio", blob, "audio/wav", signal)),
                artworkFile && supportedArtworkMime(artworkFile)
                    ? this.relay.upload("artwork", artworkFile, supportedArtworkMime(artworkFile)!, signal)
                    : Promise.resolve<RelayAsset | null>(null),
            ]);
            if (operation !== this.operation) return;
            await this.session.publishPreview({
                assetProtocolVersion: ASSET_PROTOCOL_VERSION,
                songId: identity.songId,
                title: song.title,
                subtitle: song.simfile.subtitle,
                artist: song.artist,
                artwork: artwork?.kind === "artwork" ? artwork : null,
                audioPreview: audioPreview.kind === "preview-audio" ? audioPreview : null,
                previewDurationSeconds: duration,
            });
        } catch (error) {
            if (!signal.aborted) console.error("Could not share room preview:", error);
        }
    }

    public async clearPublishedPreview(): Promise<void> {
        this.beginOperation();
        const state = this.session.getState();
        if (state.room?.hostPlayerId === state.localPlayerId && state.room.preview) {
            try { await this.session.clearPreview(); } catch (error) { console.error("Could not clear room preview:", error); }
        }
    }

    public destroy(): void {
        this.beginOperation();
        this.unsubscribe?.();
        this.view.destroy();
        this.revokeUrls();
    }

    private handleState(state: Readonly<RoomSessionState>): void {
        const preview = state.room?.preview;
        const isGuest = Boolean(state.room && state.localPlayerId && state.room.hostPlayerId !== state.localPlayerId);
        if (!preview || !isGuest) {
            this.shownRevision = preview?.previewRevision ?? 0;
            this.view.close();
            this.revokeUrls();
            return;
        }
        if (preview.previewRevision === this.shownRevision) return;
        this.shownRevision = preview.previewRevision;
        void this.showGuestPreview(preview);
    }

    private async showGuestPreview(preview: RoomPreview): Promise<void> {
        const operation = this.beginOperation();
        const signal = this.abort!.signal;
        this.revokeUrls();
        this.view.show(preview);
        try {
            const [artworkBlob, audioBlob] = await Promise.all([
                preview.artwork ? this.relay.download(preview.artwork, signal) : null,
                preview.audioPreview ? this.relay.download(preview.audioPreview, signal) : null,
            ]);
            if (operation !== this.operation) return;
            this.artworkUrl = artworkBlob ? URL.createObjectURL(artworkBlob) : null;
            this.audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : null;
            this.view.setArtwork(this.artworkUrl);
            await this.view.setAudio(this.audioUrl);
        } catch (error) {
            if (!signal.aborted) this.view.showError(error instanceof Error ? error.message : "Could not load shared preview.");
        }
    }

    private beginOperation(): number {
        this.operation += 1;
        this.abort?.abort();
        this.abort = new AbortController();
        return this.operation;
    }

    private revokeUrls(): void {
        if (this.artworkUrl) URL.revokeObjectURL(this.artworkUrl);
        if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
        this.artworkUrl = null;
        this.audioUrl = null;
        this.view.setArtwork(null);
    }
}

function supportedArtworkMime(file: File): "image/jpeg" | "image/png" | "image/webp" | null {
    if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") return file.type;
    const extension = file.name.toLowerCase().split(".").pop();
    return extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : null;
}
