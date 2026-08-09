import {
    CHART_IDENTITY_VERSION,
    CHART_SLOT_IDENTITY_VERSION,
    SONG_IDENTITY_VERSION,
} from "../../shared/constants";
import { RuntimeChartBuilder } from "../stepmania/RuntimeChartBuilder";
import type {
    BpmSegment,
    RuntimeChartNote,
    StepManiaChart,
    StepManiaSimfile,
} from "../types/Chart";
import type {
    AvailableChartIdentityRecord,
    ChartIdentityRecord,
} from "../types/Library";

interface CanonicalSongPayload {
    identityVersion: typeof SONG_IDENTITY_VERSION;
    title: string;
    subtitle: string;
    artist: string;
    offsetSeconds: number;
    bpmSegments: CanonicalBpmSegment[];
}

interface CanonicalBpmSegment {
    beat: number;
    bpm: number;
}

interface CanonicalChartSlotPayload {
    identityVersion: typeof CHART_SLOT_IDENTITY_VERSION;
    songId: string;
    stepType: string;
    description: string;
    difficulty: string;
    meter: number;
}

interface CanonicalRuntimeChartPayload {
    identityVersion: typeof CHART_IDENTITY_VERSION;
    offsetSeconds: number;
    bpmSegments: CanonicalBpmSegment[];
    stepType: "dance-single";
    notes: CanonicalRuntimeNote[];
}

interface CanonicalRuntimeNote {
    lane: number;
    beat: number;
    hitTimeSeconds: number;
}

export class ChartIdentityService {
    private readonly runtimeChartBuilder =
        new RuntimeChartBuilder();

    public async indexSimfile(
        simfile: StepManiaSimfile,
    ): Promise<ChartIdentityRecord[]> {
        const records: ChartIdentityRecord[] =
            simfile.charts.map((_, chartIndex) => ({
                chartIndex,
                state: "hashing",
            }));

        let songId: string;

        try {
            songId = await this.createSongId(simfile);
        } catch (error) {
            return records.map((record) => ({
                chartIndex: record.chartIndex,
                state: "failed",
                error: this.getErrorMessage(error),
            }));
        }

        await Promise.all(
            simfile.charts.map(async (chart, chartIndex) => {
                try {
                    records[chartIndex] =
                        await this.createChartIdentity(
                            simfile,
                            chart,
                            chartIndex,
                            songId,
                        );
                } catch (error) {
                    records[chartIndex] = {
                        chartIndex,
                        state: "failed",
                        error: this.getErrorMessage(error),
                    };
                }
            }),
        );

        return records;
    }

    public async createSongId(
        simfile: StepManiaSimfile,
    ): Promise<string> {
        const payload: CanonicalSongPayload = {
            identityVersion: SONG_IDENTITY_VERSION,
            title: this.normalizeString(simfile.title),
            subtitle: this.normalizeString(simfile.subtitle),
            artist: this.normalizeString(simfile.artist),
            offsetSeconds: this.normalizeNumber(
                simfile.offsetSeconds,
            ),
            bpmSegments: this.normalizeBpmSegments(
                simfile.bpmSegments,
            ),
        };

        return this.hashWithPrefix(
            SONG_IDENTITY_VERSION,
            payload,
        );
    }

    private async createChartIdentity(
        simfile: StepManiaSimfile,
        chart: StepManiaChart,
        chartIndex: number,
        songId: string,
    ): Promise<AvailableChartIdentityRecord> {
        const runtimeNotes =
            this.runtimeChartBuilder.build(simfile, chart);

        if (runtimeNotes.length === 0) {
            throw new Error(
                "Chart contains no supported tap notes.",
            );
        }

        const chartSlotPayload: CanonicalChartSlotPayload = {
            identityVersion: CHART_SLOT_IDENTITY_VERSION,
            songId,
            stepType: this.normalizeString(
                chart.stepType,
            ).toLowerCase(),
            description: this.normalizeString(
                chart.description,
            ),
            difficulty: this.normalizeString(
                chart.difficulty,
            ),
            meter: chart.meter,
        };

        const runtimePayload: CanonicalRuntimeChartPayload = {
            identityVersion: CHART_IDENTITY_VERSION,
            offsetSeconds: this.normalizeNumber(
                simfile.offsetSeconds,
            ),
            bpmSegments: this.normalizeBpmSegments(
                simfile.bpmSegments,
            ),
            stepType: "dance-single",
            notes: this.normalizeRuntimeNotes(runtimeNotes),
        };

        const durationSeconds = Math.max(
            ...runtimePayload.notes.map(
                (note) => note.hitTimeSeconds,
            ),
        );

        if (durationSeconds <= 0) {
            throw new Error(
                "Chart duration must be greater than zero.",
            );
        }

        const [chartId, chartHash] = await Promise.all([
            this.hashWithPrefix(
                CHART_SLOT_IDENTITY_VERSION,
                chartSlotPayload,
            ),
            this.hashWithPrefix(
                CHART_IDENTITY_VERSION,
                runtimePayload,
            ),
        ]);

        return {
            chartIndex,
            state: "available",
            songId,
            chartId,
            chartHash,
            tapCount: runtimePayload.notes.length,
            durationSeconds,
        };
    }

    private normalizeBpmSegments(
        segments: readonly BpmSegment[],
    ): CanonicalBpmSegment[] {
        return segments
            .map((segment) => ({
                beat: this.normalizeNumber(segment.beat),
                bpm: this.normalizeNumber(segment.bpm),
            }))
            .sort(
                (left, right) =>
                    left.beat - right.beat ||
                    left.bpm - right.bpm,
            );
    }

    private normalizeRuntimeNotes(
        notes: readonly RuntimeChartNote[],
    ): CanonicalRuntimeNote[] {
        return notes
            .map((note) => ({
                lane: note.lane,
                beat: this.normalizeNumber(note.beat),
                hitTimeSeconds: this.normalizeNumber(
                    note.hitTimeSeconds,
                ),
            }))
            .sort(
                (left, right) =>
                    left.hitTimeSeconds -
                        right.hitTimeSeconds ||
                    left.beat - right.beat ||
                    left.lane - right.lane,
            );
    }

    private normalizeString(value: string): string {
        return value.normalize("NFC").trim();
    }

    private normalizeNumber(value: number): number {
        if (!Number.isFinite(value)) {
            throw new Error(
                "Chart identity cannot contain a non-finite number.",
            );
        }

        return Object.is(value, -0) ? 0 : value;
    }

    private async hashWithPrefix(
        prefix: string,
        payload: object,
    ): Promise<string> {
        const subtle = globalThis.crypto?.subtle;

        if (!subtle) {
            throw new Error(
                "Web Crypto SHA-256 is unavailable in this browser.",
            );
        }

        const bytes = new TextEncoder().encode(
            JSON.stringify(payload),
        );

        const digest = await subtle.digest("SHA-256", bytes);
        const hex = Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");

        return `${prefix}:${hex}`;
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error
            ? error.message
            : "Unknown chart identity error.";
    }
}
