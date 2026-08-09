import { describe, expect, it } from "vitest";

import {
    CHART_IDENTITY_VERSION,
    CHART_SLOT_IDENTITY_VERSION,
    SONG_IDENTITY_VERSION,
} from "../../shared/constants";
import { SimfileParser } from "../stepmania/SimfileParser";
import { ChartIdentityService } from "./ChartIdentityService";

interface SimfileOptions {
    title?: string;
    difficulty?: string;
    meter?: number;
    bpms?: string;
    offset?: string;
    noteData?: string;
}

const defaultNoteData = `
0000
1000
0000
0001
`;

function createSimfileText(options: SimfileOptions = {}): string {
    return `
#TITLE:${options.title ?? "Test Song"};
#SUBTITLE:;
#ARTIST:Test Artist;
#MUSIC:test.ogg;
#OFFSET:${options.offset ?? "0"};
#BPMS:${options.bpms ?? "0=120"};
#NOTES:
     dance-single:
     Test chart:
     ${options.difficulty ?? "Hard"}:
     ${options.meter ?? 8}:
     0,0,0,0,0:
${options.noteData ?? defaultNoteData}
;
`;
}

async function indexFirstChart(text: string) {
    const parser = new SimfileParser();
    const service = new ChartIdentityService();
    const records = await service.indexSimfile(
        parser.parse(text),
    );
    const record = records[0];

    expect(record?.state).toBe("available");
    if (!record || record.state !== "available") {
        throw new Error("Expected an available chart identity.");
    }

    return record;
}

describe("ChartIdentityService", () => {
    it("produces versioned SHA-256 identities", async () => {
        const identity = await indexFirstChart(
            createSimfileText(),
        );

        expect(identity.songId).toMatch(
            new RegExp(`^${SONG_IDENTITY_VERSION}:[a-f0-9]{64}$`),
        );
        expect(identity.chartId).toMatch(
            new RegExp(
                `^${CHART_SLOT_IDENTITY_VERSION}:[a-f0-9]{64}$`,
            ),
        );
        expect(identity.chartHash).toMatch(
            new RegExp(
                `^${CHART_IDENTITY_VERSION}:[a-f0-9]{64}$`,
            ),
        );
        expect(identity.tapCount).toBe(2);
        expect(identity.durationSeconds).toBe(1.5);
    });

    it("ignores whitespace, line endings, and comments", async () => {
        const compact = createSimfileText();
        const formatted = createSimfileText({
            noteData: `
0000 // empty

1000 // left
0000
0001 // right
`,
        }).replace(/\n/g, "\r\n");

        const [left, right] = await Promise.all([
            indexFirstChart(compact),
            indexFirstChart(formatted),
        ]);

        expect(right.songId).toBe(left.songId);
        expect(right.chartId).toBe(left.chartId);
        expect(right.chartHash).toBe(left.chartHash);
    });

    it("gives metadata collisions the same slot ID but different hashes", async () => {
        const [left, right] = await Promise.all([
            indexFirstChart(createSimfileText()),
            indexFirstChart(createSimfileText({
                noteData: `
0000
0100
0000
0010
`,
            })),
        ]);

        expect(right.songId).toBe(left.songId);
        expect(right.chartId).toBe(left.chartId);
        expect(right.chartHash).not.toBe(left.chartHash);
    });

    it("changes song and runtime identity when timing changes", async () => {
        const [left, right] = await Promise.all([
            indexFirstChart(createSimfileText()),
            indexFirstChart(createSimfileText({ bpms: "0=150" })),
        ]);

        expect(right.songId).not.toBe(left.songId);
        expect(right.chartHash).not.toBe(left.chartHash);
    });

    it("keeps runtime hash independent from difficulty metadata", async () => {
        const [left, right] = await Promise.all([
            indexFirstChart(createSimfileText({ difficulty: "Hard" })),
            indexFirstChart(createSimfileText({ difficulty: "Challenge" })),
        ]);

        expect(right.songId).toBe(left.songId);
        expect(right.chartId).not.toBe(left.chartId);
        expect(right.chartHash).toBe(left.chartHash);
    });

    it("records unsupported empty charts as failed without throwing", async () => {
        const parser = new SimfileParser();
        const service = new ChartIdentityService();
        const records = await service.indexSimfile(
            parser.parse(createSimfileText({
                noteData: `
0000
0000
0000
0000
`,
            })),
        );

        expect(records).toEqual([{
            chartIndex: 0,
            state: "failed",
            error: "Chart contains no supported tap notes.",
        }]);
    });
});
