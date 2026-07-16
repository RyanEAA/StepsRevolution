import type { ImportedFile } from "../types/Library";

const PATH_SEPARATOR_EXPRESSION = /[\\/]+/g;

export function normalizePath(path: string): string {
    return path
        .replace(PATH_SEPARATOR_EXPRESSION, "/")
        .replace(/^\/+|\/+$/g, "");
}

export function getFilename(path: string): string {
    const normalizedPath = normalizePath(path);
    const parts = normalizedPath.split("/");

    return parts.at(-1) ?? "";
}

export function getExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf(".");

    if (dotIndex < 0) {
        return "";
    }

    return filename
        .slice(dotIndex)
        .toLowerCase();
}

export function getDirectoryPath(path: string): string {
    const normalizedPath = normalizePath(path);
    const parts = normalizedPath.split("/");

    parts.pop();

    return parts.join("/");
}

export function getPathParts(path: string): string[] {
    return normalizePath(path)
        .split("/")
        .filter(Boolean);
}

export function normalizeFilename(filename: string): string {
    return filename.trim().toLowerCase();
}

export function createImportedFile(file: File): ImportedFile {
    const relativePath =
        file.webkitRelativePath || file.name;

    const filename = getFilename(relativePath);

    return {
        file,
        relativePath: normalizePath(relativePath),
        filename,
        normalizedFilename: normalizeFilename(filename),
        extension: getExtension(filename),
    };
}

export function createStableId(value: string): string {
    return normalizePath(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}