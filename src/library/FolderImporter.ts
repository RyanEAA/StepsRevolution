import type { ImportedFile } from "../types/Library";
import { createImportedFile } from "./FileUtilities";

export class FolderImporter {
    public importFiles(
        fileList: FileList | readonly File[],
    ): ImportedFile[] {
        return Array.from(fileList)
            .map((file) => createImportedFile(file))
            .filter((file) => file.relativePath.length > 0)
            .sort((left, right) =>
                left.relativePath.localeCompare(
                    right.relativePath,
                ),
            );
    }
}