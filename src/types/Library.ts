import type { StepManiaSimfile } from "./Chart";

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