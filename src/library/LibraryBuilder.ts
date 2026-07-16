import type {
    ImportedFile,
    SongEntry,
    SongLibrary,
    SongPack,
} from "../types/Library";

import { SimfileParser } from "../stepmania/SimfileParser";
import { AssetMatcher } from "./AssetMatcher";

import {
    createStableId,
    getDirectoryPath,
    getPathParts,
} from "./FileUtilities";

interface SongFolderGroup {
    relativeFolderPath: string;
    files: ImportedFile[];
}

interface PackGroup {
    relativePath: string;
    name: string;
    songFolders: SongFolderGroup[];
    rootFiles: ImportedFile[];
}

export class LibraryBuilder {
    private readonly parser = new SimfileParser();
    private readonly assetMatcher = new AssetMatcher();

    public async build(
        importedFiles: readonly ImportedFile[],
    ): Promise<SongLibrary> {
        const warnings: string[] = [];

        const packGroups =
            this.groupFilesIntoPacks(importedFiles);

        const packs: SongPack[] = [];
        let skippedSongFolders = 0;

        for (const packGroup of packGroups) {
            const songs: SongEntry[] = [];

            for (const songFolder of packGroup.songFolders) {
                try {
                    const song = await this.buildSong(
                        packGroup,
                        songFolder,
                    );

                    if (!song) {
                        skippedSongFolders += 1;

                        warnings.push(
                            `Skipped "${songFolder.relativeFolderPath}": no .sm file found.`,
                        );

                        continue;
                    }

                    songs.push(song);
                } catch (error) {
                    skippedSongFolders += 1;

                    warnings.push(
                        `Skipped "${songFolder.relativeFolderPath}": ${error instanceof Error
                            ? error.message
                            : "unknown error"
                        }`,
                    );
                }
            }

            if (songs.length === 0) {
                continue;
            }

            songs.sort((left, right) =>
                left.title.localeCompare(right.title),
            );

            const artworkFile =
                this.assetMatcher.findPackArtwork(
                    packGroup.rootFiles,
                )?.file ??
                songs.find((song) => song.bannerFile)
                    ?.bannerFile ??
                null;

            packs.push({
                id: createStableId(packGroup.relativePath),
                name: packGroup.name,
                relativePath: packGroup.relativePath,
                artworkFile,
                artworkUrl: artworkFile
                    ? URL.createObjectURL(artworkFile)
                    : null,
                songs,
            });
        }

        packs.sort((left, right) =>
            left.name.localeCompare(right.name),
        );

        return {
            packs,
            totalSongs: packs.reduce(
                (total, pack) =>
                    total + pack.songs.length,
                0,
            ),
            skippedSongFolders,
            warnings,
        };
    }

    public releaseLibraryUrls(
        library: SongLibrary,
    ): void {
        for (const pack of library.packs) {
            if (pack.artworkUrl) {
                URL.revokeObjectURL(pack.artworkUrl);
            }

            for (const song of pack.songs) {
                if (song.bannerUrl) {
                    URL.revokeObjectURL(song.bannerUrl);
                }

                if (song.backgroundUrl) {
                    URL.revokeObjectURL(
                        song.backgroundUrl,
                    );
                }
            }
        }
    }

    private groupFilesIntoPacks(
        files: readonly ImportedFile[],
    ): PackGroup[] {
        const packMap = new Map<string, PackGroup>();

        for (const file of files) {
            const pathParts =
                getPathParts(file.relativePath);

            /*
             * A directory selection commonly produces:
             *
             * SelectedRoot/Pack/Song/file.sm
             *
             * or:
             *
             * Pack/Song/file.sm
             */
            if (pathParts.length < 2) {
                continue;
            }

            const folderParts = pathParts.slice(0, -1);

            if (folderParts.length < 2) {
                continue;
            }

            const packIndex =
                folderParts.length >= 3
                    ? 1
                    : 0;

            const packName =
                folderParts[packIndex] ??
                "Imported Pack";

            const packPath = folderParts
                .slice(0, packIndex + 1)
                .join("/");

            let packGroup = packMap.get(packPath);

            if (!packGroup) {
                packGroup = {
                    relativePath: packPath,
                    name: packName,
                    songFolders: [],
                    rootFiles: [],
                };

                packMap.set(packPath, packGroup);
            }

            const fileDirectory =
                getDirectoryPath(file.relativePath);

            if (fileDirectory === packPath) {
                packGroup.rootFiles.push(file);
                continue;
            }

            let songFolder =
                packGroup.songFolders.find(
                    (folder) =>
                        folder.relativeFolderPath ===
                        fileDirectory,
                );

            if (!songFolder) {
                songFolder = {
                    relativeFolderPath:
                        fileDirectory,
                    files: [],
                };

                packGroup.songFolders.push(
                    songFolder,
                );
            }

            songFolder.files.push(file);
        }

        return Array.from(packMap.values());
    }

    private async buildSong(
        packGroup: PackGroup,
        songFolder: SongFolderGroup,
    ): Promise<SongEntry | null> {
        const simfileImportedFile =
            songFolder.files.find(
                (file) => file.extension === ".sm",
            );

        if (!simfileImportedFile) {
            return null;
        }

        const contents =
            await simfileImportedFile.file.text();

        const simfile =
            this.parser.parse(contents);

        if (simfile.charts.length === 0) {
            throw new Error(
                "No supported dance-single charts found.",
            );
        }

        const folderParts =
            getPathParts(
                songFolder.relativeFolderPath,
            );

        const folderName =
            folderParts.at(-1) ??
            simfile.title ??
            "Untitled Song";

        const audioImportedFile =
            this.assetMatcher.findAudio(
                songFolder.files,
                simfile.musicFilename,
            );

        const bannerImportedFile =
            this.assetMatcher.findBanner(
                songFolder.files,
                simfile.bannerFilename,
                folderName,
            );

        const backgroundImportedFile =
            this.assetMatcher.findBackground(
                songFolder.files,
                simfile.backgroundFilename,
            );

        return {
            id: createStableId(
                songFolder.relativeFolderPath,
            ),

            packId: createStableId(
                packGroup.relativePath,
            ),

            packName: packGroup.name,
            folderName,
            relativeFolderPath:
                songFolder.relativeFolderPath,

            title:
                simfile.title ||
                folderName,

            artist:
                simfile.artist ||
                "Unknown artist",

            simfile,
            simfileFile:
                simfileImportedFile.file,

            audioFile:
                audioImportedFile?.file ??
                null,

            bannerFile:
                bannerImportedFile?.file ??
                null,

            backgroundFile:
                backgroundImportedFile?.file ??
                null,

            bannerUrl: bannerImportedFile
                ? URL.createObjectURL(
                    bannerImportedFile.file,
                )
                : null,

            backgroundUrl:
                backgroundImportedFile
                    ? URL.createObjectURL(
                        backgroundImportedFile.file,
                    )
                    : null,
        };
    }
}