import type { StepManiaSimfile } from "./Chart";

export type ChartIdentityState =
    | "unindexed"
    | "hashing"
    | "available"
    | "failed";

interface ChartIdentityRecordBase {
    chartIndex: number;
    state: ChartIdentityState;
}

export interface PendingChartIdentityRecord
    extends ChartIdentityRecordBase {
    state: "unindexed" | "hashing";
}

export interface AvailableChartIdentityRecord
    extends ChartIdentityRecordBase {
    state: "available";
    songId: string;
    chartId: string;
    chartHash: string;
    tapCount: number;
    durationSeconds: number;
}

export interface FailedChartIdentityRecord
    extends ChartIdentityRecordBase {
    state: "failed";
    error: string;
}

export type ChartIdentityRecord =
    | PendingChartIdentityRecord
    | AvailableChartIdentityRecord
    | FailedChartIdentityRecord;

export interface ImportedFile {
    file: File;
    relativePath: string;
    filename: string;
    normalizedFilename: string;
    extension: string;
}

export interface SongEntry {
    id: string;
    packId: string;

    packName: string;
    folderName: string;
    relativeFolderPath: string;

    title: string;
    artist: string;

    simfile: StepManiaSimfile;
    simfileFile: File;
    chartIdentities: ChartIdentityRecord[];

    audioFile: File | null;
    bannerFile: File | null;
    backgroundFile: File | null;

    bannerUrl: string | null;
    backgroundUrl: string | null;
}

export interface SongPack {
    id: string;
    name: string;
    relativePath: string;

    artworkFile: File | null;
    artworkUrl: string | null;

    songs: SongEntry[];
}

export interface SongLibrary {
    packs: SongPack[];

    totalSongs: number;
    skippedSongFolders: number;
    warnings: string[];
}
