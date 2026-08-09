import { ASSET_PROTOCOL_VERSION, runtimeSongPackagePayloadSchema } from "../../shared/relaySchemas";
import type { RoomSongPackage, RuntimeSongPackagePayload, SharedChartDescriptor } from "../../shared/relaySchemas";
import type { RelayAssetClient } from "../multiplayer/RelayAssetClient";
import type { ProposedSongPackage, RoomSession, RoomSessionState } from "../multiplayer/RoomSession";
import { RuntimeChartBuilder } from "../stepmania/RuntimeChartBuilder";
import type { SongEntry } from "../types/Library";

export interface PreparedRoomSong {
    selectionRevision: number;
    audio: Blob;
    runtime: RuntimeSongPackagePayload;
}

export interface SharedSongGameplayPort {
    prepare(
        songPackage: RoomSongPackage,
        chart: SharedChartDescriptor,
        runtime: RuntimeSongPackagePayload,
        audio: Blob,
    ): Promise<void>;
    clear(): void;
}

export class SharedSongPackageController {
    private readonly session: RoomSession;
    private readonly relay: RelayAssetClient;
    private readonly setStatus: (message: string) => void;
    private readonly gameplay: SharedSongGameplayPort;
    private readonly chartBuilder = new RuntimeChartBuilder();
    private unsubscribe: (() => void) | null = null;
    private generation = 0;
    private abort: AbortController | null = null;
    private preparingRevision: number | null = null;
    private prepared: PreparedRoomSong | null = null;
    private activeRevision: number | null = null;
    private failedRevision: number | null = null;
    private boundChoiceKey: string | null = null;
    private bindingChoiceKey: string | null = null;
    private requestedChartId: string | null = null;

    public constructor(
        session: RoomSession,
        relay: RelayAssetClient,
        setStatus: (message: string) => void,
        gameplay: SharedSongGameplayPort,
    ) {
        this.session = session;
        this.relay = relay;
        this.setStatus = setStatus;
        this.gameplay = gameplay;
    }

    public initialize(): void {
        this.unsubscribe = this.session.subscribe((state) => this.handleState(state));
    }

    public async confirmSong(song: SongEntry): Promise<void> {
        const state = this.session.getState();
        if (!state.room || state.room.hostPlayerId !== state.localPlayerId || !song.audioFile) return;
        const generation = this.startOperation();
        const signal = this.abort!.signal;
        try {
            this.setStatus("Preparing all supported difficulties…");
            const packageData = this.buildPackage(song);
            const chartBlob = new Blob([JSON.stringify(packageData.runtime)], { type: "application/json" });
            const artworkFile = song.bannerFile ?? song.backgroundFile;
            this.setStatus("Uploading song audio and charts…");
            const [audio, chartPackage, artwork] = await Promise.all([
                this.relay.upload("song-audio", song.audioFile, audioMime(song.audioFile), signal),
                this.relay.upload("chart-package", chartBlob, "application/json", signal),
                artworkFile && artworkMime(artworkFile)
                    ? this.relay.upload("artwork", artworkFile, artworkMime(artworkFile)!, signal)
                    : null,
            ]);
            if (generation !== this.generation || audio.kind !== "song-audio" || chartPackage.kind !== "chart-package") return;
            const proposal: ProposedSongPackage = {
                assetProtocolVersion: ASSET_PROTOCOL_VERSION,
                packageId: crypto.randomUUID(),
                songId: packageData.runtime.songId,
                title: song.title,
                subtitle: song.simfile.subtitle,
                artist: song.artist,
                artwork: artwork?.kind === "artwork" ? artwork : null,
                audio,
                chartPackage,
                charts: packageData.charts,
            };
            this.setStatus("Confirming shared song…");
            await this.session.commitSongPackage(proposal);
            this.setStatus("Song confirmed. Preparing it for every player…");
        } catch (error) {
            if (!signal.aborted) this.setStatus(error instanceof Error ? error.message : "Could not share the selected song.");
        }
    }

    public async selectDifficulty(chartId: string): Promise<void> {
        const room = this.session.getState().room;
        const chart = room?.songPackage?.charts.find((candidate) => candidate.chartId === chartId);
        if (!room || !chart) return;
        this.requestedChartId = chartId;
        const totalBytes = room.songPackage!.audio.byteLength + room.songPackage!.chartPackage.byteLength;
        try {
            await this.retryRevisioned(() => this.session.reportAssetPreparation({
                selectionRevision: room.selectionRevision,
                status: "verifying",
                bytesReceived: totalBytes,
                totalBytes,
                verifiedAudioHash: null,
                errorCode: null,
            }));
            await this.retryRevisioned(() => this.session.selectPlayerChart({
                selectionRevision: room.selectionRevision,
                chartId: chart.chartId,
                chartHash: chart.chartHash,
            }));
        } catch (error) {
            this.requestedChartId = null;
            throw error;
        }
    }

    public getPreparedSong(): PreparedRoomSong | null { return this.prepared; }

    public retryPreparation(): void {
        const state = this.session.getState();
        const revision = state.room?.songPackage?.selectionRevision;
        if (!revision) return;
        this.failedRevision = null;
        this.preparingRevision = null;
        this.boundChoiceKey = null;
        this.setStatus("Retrying shared song preparation…");
        this.handleState(state);
    }

    public destroy(): void {
        this.startOperation();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.prepared = null;
        this.gameplay.clear();
    }

    private buildPackage(song: SongEntry): { runtime: RuntimeSongPackagePayload; charts: SharedChartDescriptor[] } {
        const charts: SharedChartDescriptor[] = [];
        const runtimeCharts: RuntimeSongPackagePayload["charts"] = [];
        for (const identity of song.chartIdentities) {
            if (identity.state !== "available") continue;
            const chart = song.simfile.charts[identity.chartIndex];
            if (!chart) continue;
            charts.push({
                chartId: identity.chartId, chartHash: identity.chartHash,
                stepType: "dance-single", description: chart.description,
                difficulty: chart.difficulty, meter: chart.meter,
                tapCount: identity.tapCount, durationSeconds: identity.durationSeconds,
            });
            runtimeCharts.push({
                chartId: identity.chartId,
                chartHash: identity.chartHash,
                notes: this.chartBuilder.build(song.simfile, chart),
            });
        }
        if (charts.length === 0) throw new Error("This song has no indexed dance-single difficulties.");
        const firstIdentity = song.chartIdentities.find((record) => record.state === "available");
        if (!firstIdentity || firstIdentity.state !== "available") throw new Error("This song has no indexed identity.");
        const runtime = runtimeSongPackagePayloadSchema.parse({
            assetProtocolVersion: ASSET_PROTOCOL_VERSION,
            songId: firstIdentity.songId,
            offsetSeconds: song.simfile.offsetSeconds,
            bpmSegments: song.simfile.bpmSegments,
            charts: runtimeCharts,
        });
        return { runtime, charts };
    }

    private handleState(state: Readonly<RoomSessionState>): void {
        const songPackage = state.room?.songPackage;
        if (!songPackage) {
            if (this.activeRevision !== null) this.gameplay.clear();
            this.activeRevision = null;
            this.prepared = null;
            this.preparingRevision = null;
            this.failedRevision = null;
            this.boundChoiceKey = null;
            this.requestedChartId = null;
            return;
        }
        if (this.activeRevision !== songPackage.selectionRevision) {
            this.startOperation();
            this.gameplay.clear();
            this.activeRevision = songPackage.selectionRevision;
            this.prepared = null;
            this.preparingRevision = null;
            this.failedRevision = null;
            this.boundChoiceKey = null;
            this.requestedChartId = null;
        }
        if (this.prepared?.selectionRevision === songPackage.selectionRevision) {
            void this.synchronizeGameplay(state);
            return;
        }
        if (this.failedRevision === songPackage.selectionRevision) return;
        if (this.preparingRevision === songPackage.selectionRevision) return;
        this.preparingRevision = songPackage.selectionRevision;
        void this.prepare(songPackage).finally(() => {
            if (this.preparingRevision === songPackage.selectionRevision) this.preparingRevision = null;
        });
    }

    private async prepare(songPackage: RoomSongPackage): Promise<void> {
        const generation = this.startOperation();
        const signal = this.abort!.signal;
        const totalBytes = songPackage.audio.byteLength + songPackage.chartPackage.byteLength;
        try {
            this.setStatus("Downloading the confirmed song…");
            await this.retryRevisioned(() => this.session.reportAssetPreparation({
                selectionRevision: songPackage.selectionRevision, status: "downloading",
                bytesReceived: 0, totalBytes, verifiedAudioHash: null, errorCode: null,
            }));
            const [audio, chartBlob] = await Promise.all([
                this.relay.download(songPackage.audio, signal),
                this.relay.download(songPackage.chartPackage, signal),
            ]);
            if (generation !== this.generation) return;
            this.setStatus("Verifying shared song package…");
            await this.retryRevisioned(() => this.session.reportAssetPreparation({
                selectionRevision: songPackage.selectionRevision, status: "verifying",
                bytesReceived: totalBytes, totalBytes, verifiedAudioHash: null, errorCode: null,
            }));
            const runtime = runtimeSongPackagePayloadSchema.parse(JSON.parse(await chartBlob.text()));
            validateRuntimePackage(runtime, songPackage);
            await verifyAudioDecodes(audio);
            this.prepared = { selectionRevision: songPackage.selectionRevision, audio, runtime };
            await this.retryRevisioned(() => this.session.reportAssetPreparation({
                selectionRevision: songPackage.selectionRevision, status: "prepared",
                bytesReceived: totalBytes, totalBytes,
                verifiedAudioHash: songPackage.audio.sha256, errorCode: null,
            }));
            this.setStatus("Song prepared. Choose your difficulty.");
            await this.synchronizeGameplay(this.session.getState());
        } catch (error) {
            if (signal.aborted) return;
            this.failedRevision = songPackage.selectionRevision;
            this.setStatus(error instanceof Error ? error.message : "Song preparation failed.");
            await this.retryRevisioned(() => this.session.reportAssetPreparation({
                selectionRevision: songPackage.selectionRevision, status: "failed",
                bytesReceived: 0, totalBytes, verifiedAudioHash: null, errorCode: "download-or-validation-failed",
            })).catch(() => undefined);
        }
    }

    private async synchronizeGameplay(state: Readonly<RoomSessionState>): Promise<void> {
        const songPackage = state.room?.songPackage;
        const prepared = this.prepared;
        const player = state.room?.players.find((candidate) => candidate.playerId === state.localPlayerId);
        const choice = player?.chartChoice;
        if (!songPackage || !prepared || prepared.selectionRevision !== songPackage.selectionRevision ||
            !choice || choice.selectionRevision !== songPackage.selectionRevision) return;
        if (this.requestedChartId && choice.chartId !== this.requestedChartId) return;
        const chart = songPackage.charts.find((candidate) =>
            candidate.chartId === choice.chartId && candidate.chartHash === choice.chartHash);
        if (!chart) return;
        const key = `${songPackage.selectionRevision}:${chart.chartId}:${chart.chartHash}`;
        if (this.boundChoiceKey === key || this.bindingChoiceKey === key) return;
        this.bindingChoiceKey = key;
        const totalBytes = songPackage.audio.byteLength + songPackage.chartPackage.byteLength;
        try {
            this.setStatus(`Loading ${chart.difficulty} into gameplay…`);
            await this.retryRevisioned(() => this.session.reportAssetPreparation({
                selectionRevision: songPackage.selectionRevision, status: "verifying",
                bytesReceived: totalBytes, totalBytes, verifiedAudioHash: null, errorCode: null,
            }));
            await this.gameplay.prepare(songPackage, chart, prepared.runtime, prepared.audio);
            this.boundChoiceKey = key;
            this.requestedChartId = null;
            await this.retryRevisioned(() => this.session.reportAssetPreparation({
                selectionRevision: songPackage.selectionRevision, status: "prepared",
                bytesReceived: totalBytes, totalBytes,
                verifiedAudioHash: songPackage.audio.sha256, errorCode: null,
            }));
            this.setStatus(`${chart.difficulty} is loaded and ready.`);
        } catch (error) {
            this.failedRevision = songPackage.selectionRevision;
            this.setStatus(error instanceof Error ? error.message : "Could not load the selected difficulty.");
            await this.retryRevisioned(() => this.session.reportAssetPreparation({
                selectionRevision: songPackage.selectionRevision, status: "failed",
                bytesReceived: totalBytes, totalBytes, verifiedAudioHash: null,
                errorCode: "gameplay-preparation-failed",
            })).catch(() => undefined);
        } finally {
            if (this.bindingChoiceKey === key) this.bindingChoiceKey = null;
        }
    }

    private async retryRevisioned(action: () => Promise<void>): Promise<void> {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            try { await action(); return; } catch (error) {
                if (!(typeof error === "object" && error !== null && "code" in error && error.code === "stale-room-revision") || attempt === 3) throw error;
                await new Promise((resolve) => setTimeout(resolve, 75));
            }
        }
    }

    private startOperation(): number {
        this.generation += 1;
        this.abort?.abort();
        this.abort = new AbortController();
        return this.generation;
    }
}

function validateRuntimePackage(runtime: RuntimeSongPackagePayload, songPackage: RoomSongPackage): void {
    if (runtime.songId !== songPackage.songId || runtime.charts.length !== songPackage.charts.length) throw new Error("The chart package does not match the confirmed song.");
    for (const chart of songPackage.charts) {
        if (!runtime.charts.some((candidate) => candidate.chartId === chart.chartId && candidate.chartHash === chart.chartHash)) {
            throw new Error("A confirmed difficulty is missing from the chart package.");
        }
    }
}

function audioMime(file: File): string {
    if (file.type.startsWith("audio/")) return file.type;
    const extension = file.name.toLowerCase().split(".").pop();
    return extension === "ogg" ? "audio/ogg" : extension === "wav" ? "audio/wav" : extension === "m4a" ? "audio/mp4" : "audio/mpeg";
}

function artworkMime(file: File): "image/jpeg" | "image/png" | "image/webp" | null {
    if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") return file.type;
    const extension = file.name.toLowerCase().split(".").pop();
    return extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : null;
}

async function verifyAudioDecodes(audio: Blob): Promise<void> {
    const context = new AudioContext();
    try {
        const decoded = await context.decodeAudioData(await audio.arrayBuffer());
        if (!(decoded.duration > 0)) throw new Error("The shared audio is empty.");
    } catch (error) {
        throw new Error("The shared audio could not be decoded by this browser.", { cause: error });
    } finally {
        await context.close();
    }
}
