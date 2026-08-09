import { describe, expect, it } from "vitest";

import type { ImportedFile } from "../types/Library";
import { ChartAvailabilityIndex } from "./ChartAvailabilityIndex";
import { LibraryBuilder } from "./LibraryBuilder";

const simfileText = `
#TITLE:Builder Test;
#ARTIST:Dance Vision;
#MUSIC:test.ogg;
#OFFSET:0;
#BPMS:0=120;
#NOTES:
     dance-single:
     Test:
     Hard:
     8:
     0,0,0,0,0:
0000
1000
0000
0001
;
`;

function importedFile(
    file: File,
    relativePath: string,
): ImportedFile {
    const filename = relativePath.split("/").at(-1)!;
    const extensionIndex = filename.lastIndexOf(".");

    return {
        file,
        relativePath,
        filename,
        normalizedFilename: filename.toLowerCase(),
        extension:
            extensionIndex >= 0
                ? filename.slice(extensionIndex).toLowerCase()
                : "",
    };
}

describe("LibraryBuilder chart identity integration", () => {
    it("indexes imported charts and exposes them through availability lookup", async () => {
        const builder = new LibraryBuilder();
        const library = await builder.build([
            importedFile(
                new File([simfileText], "test.sm", {
                    type: "text/plain",
                }),
                "Songs/Pack/Song/test.sm",
            ),
            importedFile(
                new File([new Uint8Array([1, 2, 3])], "test.ogg", {
                    type: "audio/ogg",
                }),
                "Songs/Pack/Song/test.ogg",
            ),
        ]);

        try {
            const song = library.packs[0]?.songs[0];
            const identity = song?.chartIdentities[0];

            expect(identity?.state).toBe("available");
            if (!song || !identity || identity.state !== "available") {
                throw new Error("Expected an indexed imported chart.");
            }

            const index = new ChartAvailabilityIndex();
            index.rebuild(library);
            const availability = index.checkSelection({
                selectionRevision: 1,
                songId: identity.songId,
                chartId: identity.chartId,
                chartHash: identity.chartHash,
            });

            expect(availability.status).toBe("matching-chart");
            expect(availability.audioReady).toBe(true);
            expect(library.warnings).toEqual([]);
        } finally {
            builder.releaseLibraryUrls(library);
        }
    });
});
