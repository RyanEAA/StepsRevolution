import { normalizeFilename } from "./FileUtilities";
import type { ImportedFile } from "../types/Library";


const AUDIO_EXTENSIONS = new Set([
    ".mp3",
    ".ogg",
    ".wav",
    ".m4a",
    ".aac",
    ".flac",
]);

const IMAGE_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
]);

export class AssetMatcher {
    public findAudio(
        files: readonly ImportedFile[],
        declaredFilename: string,
    ): ImportedFile | null {
        return (
            this.findDeclaredFile(
                files,
                declaredFilename,
                AUDIO_EXTENSIONS,
            ) ??
            files.find((file) =>
                AUDIO_EXTENSIONS.has(file.extension),
            ) ??
            null
        );
    }

    public findBanner(
        files: readonly ImportedFile[],
        declaredFilename: string,
        songFolderName: string,
    ): ImportedFile | null {
        const declared = this.findDeclaredFile(
            files,
            declaredFilename,
            IMAGE_EXTENSIONS,
        );

        if (declared) {
            return declared;
        }

        const normalizedFolderName =
            normalizeFilename(songFolderName);

        const matchingFolderImage = files.find((file) => {
            if (!IMAGE_EXTENSIONS.has(file.extension)) {
                return false;
            }

            const filenameWithoutExtension =
                this.removeExtension(
                    file.normalizedFilename,
                );

            return filenameWithoutExtension === normalizedFolderName;
        });

        if (matchingFolderImage) {
            return matchingFolderImage;
        }

        return (
            files.find(
                (file) =>
                    IMAGE_EXTENSIONS.has(file.extension) &&
                    !this.looksLikeBackground(file.filename),
            ) ??
            null
        );
    }

    public findBackground(
        files: readonly ImportedFile[],
        declaredFilename: string,
    ): ImportedFile | null {
        const declared = this.findDeclaredFile(
            files,
            declaredFilename,
            IMAGE_EXTENSIONS,
        );

        if (declared) {
            return declared;
        }

        return (
            files.find(
                (file) =>
                    IMAGE_EXTENSIONS.has(file.extension) &&
                    this.looksLikeBackground(file.filename),
            ) ??
            null
        );
    }

    public findPackArtwork(
        files: readonly ImportedFile[],
    ): ImportedFile | null {
        const preferredNames = [
            "pack.png",
            "pack.jpg",
            "pack.jpeg",
            "banner.png",
            "banner.jpg",
            "banner.jpeg",
            "jacket.png",
            "jacket.jpg",
            "jacket.jpeg",
        ];

        for (const preferredName of preferredNames) {
            const match = files.find(
                (file) =>
                    file.normalizedFilename === preferredName,
            );

            if (match) {
                return match;
            }
        }

        return (
            files.find((file) =>
                IMAGE_EXTENSIONS.has(file.extension),
            ) ??
            null
        );
    }

    private findDeclaredFile(
        files: readonly ImportedFile[],
        declaredFilename: string,
        allowedExtensions: ReadonlySet<string>,
    ): ImportedFile | null {
        if (!declaredFilename.trim()) {
            return null;
        }

        const normalizedDeclaredFilename =
            normalizeFilename(declaredFilename);

        return (
            files.find(
                (file) =>
                    file.normalizedFilename ===
                    normalizedDeclaredFilename &&
                    allowedExtensions.has(file.extension),
            ) ??
            null
        );
    }

    private looksLikeBackground(filename: string): boolean {
        const normalized = normalizeFilename(filename);

        return (
            normalized.includes("-bg") ||
            normalized.includes("_bg") ||
            normalized.includes("background")
        );
    }

    private removeExtension(filename: string): string {
        const dotIndex = filename.lastIndexOf(".");

        return dotIndex >= 0
            ? filename.slice(0, dotIndex)
            : filename;
    }
}