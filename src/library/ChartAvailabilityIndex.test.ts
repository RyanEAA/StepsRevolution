import { describe, expect, it } from "vitest";

import { CHART_IDENTITY_VERSION } from "../../shared/constants";
import type {
    AvailableChartIdentityRecord,
    SongEntry,
    SongLibrary,
} from "../types/Library";
import type {
    StepManiaChart,
    StepManiaSimfile,
} from "../types/Chart";
import { ChartAvailabilityIndex } from "./ChartAvailabilityIndex";

const identity: AvailableChartIdentityRecord = {
    chartIndex: 0,
    state: "available",
    songId: "dance-vision-song-v1:song",
    chartId: "dance-vision-chart-slot-v1:chart",
    chartHash:
        `${CHART_IDENTITY_VERSION}:${"a".repeat(64)}`,
    tapCount: 2,
    durationSeconds: 1.5,
};

const chart: StepManiaChart = {
    stepType: "dance-single",
    description: "Test",
    difficulty: "Hard",
    meter: 8,
    radarValues: [],
    notes: [
        { lane: 0, beat: 1 },
        { lane: 3, beat: 3 },
    ],
};

const simfile: StepManiaSimfile = {
    title: "Test Song",
    subtitle: "",
    artist: "Test Artist",
    musicFilename: "test.ogg",
    bannerFilename: "",
    backgroundFilename: "",
    offsetSeconds: 0,
    sampleStartSeconds: 0,
    sampleLengthSeconds: 10,
    bpmSegments: [{ beat: 0, bpm: 120 }],
    charts: [chart],
};

function createLibrary(hasAudio = true): SongLibrary {
    const file = {} as File;
    const song: SongEntry = {
        id: "local-song",
        packId: "pack",
        packName: "Pack",
        folderName: "Song",
        relativeFolderPath: "Pack/Song",
        title: simfile.title,
        artist: simfile.artist,
        simfile,
        simfileFile: file,
        chartIdentities: [identity],
        audioFile: hasAudio ? file : null,
        bannerFile: null,
        backgroundFile: null,
        bannerUrl: null,
        backgroundUrl: null,
    };

    return {
        packs: [{
            id: "pack",
            name: "Pack",
            relativePath: "Pack",
            artworkFile: null,
            artworkUrl: null,
            songs: [song],
        }],
        totalSongs: 1,
        skippedSongFolders: 0,
        warnings: [],
    };
}

function selection(overrides: Partial<{
    songId: string;
    chartId: string;
    chartHash: string;
}> = {}) {
    return {
        selectionRevision: 7,
        songId: overrides.songId ?? identity.songId,
        chartId: overrides.chartId ?? identity.chartId,
        chartHash: overrides.chartHash ?? identity.chartHash,
    };
}

describe("ChartAvailabilityIndex", () => {
    it("finds an exact hash and reports local audio readiness", () => {
        const index = new ChartAvailabilityIndex();
        index.rebuild(createLibrary());

        const availability = index.checkSelection(selection());

        expect(availability.status).toBe("matching-chart");
        expect(availability.audioReady).toBe(true);
        expect(availability.match?.chart).toBe(chart);
        expect(index.findByChartHash(identity.chartHash)).toHaveLength(1);
    });

    it("keeps an exact chart match when local audio is missing", () => {
        const index = new ChartAvailabilityIndex();
        index.rebuild(createLibrary(false));

        const availability = index.checkSelection(selection());
        expect(availability.status).toBe("matching-chart");
        expect(availability.audioReady).toBe(false);
    });

    it("distinguishes mismatch, missing chart, and missing song", () => {
        const index = new ChartAvailabilityIndex();
        index.rebuild(createLibrary());

        expect(index.checkSelection(selection({
            chartHash:
                `${CHART_IDENTITY_VERSION}:${"b".repeat(64)}`,
        })).status).toBe("chart-mismatch");

        expect(index.checkSelection(selection({
            chartId: "different-chart",
            chartHash:
                `${CHART_IDENTITY_VERSION}:${"b".repeat(64)}`,
        })).status).toBe("chart-missing");

        expect(index.checkSelection(selection({
            songId: "different-song",
            chartId: "different-chart",
            chartHash:
                `${CHART_IDENTITY_VERSION}:${"b".repeat(64)}`,
        })).status).toBe("song-missing");
    });

    it("clears stale library entries", () => {
        const index = new ChartAvailabilityIndex();
        index.rebuild(createLibrary());
        index.clear();

        expect(index.findByChartHash(identity.chartHash)).toEqual([]);
    });
});
