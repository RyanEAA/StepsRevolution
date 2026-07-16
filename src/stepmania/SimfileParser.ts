import type {
    BpmSegment,
    ParsedChartNote,
    StepManiaChart,
    StepManiaSimfile,
} from "../types/Chart";
import type { Lane } from "../types/Note";

const LANES_PER_ROW = 4;
const BEATS_PER_MEASURE = 4;

export class SimfileParser {
    public parse(contents: string): StepManiaSimfile {
        const normalizedContents = contents.replace(/\r\n?/g, "\n");

        return {
            title: this.getTagValue(normalizedContents, "TITLE"),
            subtitle: this.getTagValue(normalizedContents, "SUBTITLE"),
            artist: this.getTagValue(normalizedContents, "ARTIST"),

            musicFilename: this.getTagValue(
                normalizedContents,
                "MUSIC",
            ),

            bannerFilename: this.getTagValue(
                normalizedContents,
                "BANNER",
            ),

            backgroundFilename: this.getTagValue(
                normalizedContents,
                "BACKGROUND",
            ),

            offsetSeconds: this.parseNumberTag(
                normalizedContents,
                "OFFSET",
                0,
            ),

            sampleStartSeconds: this.parseNumberTag(
                normalizedContents,
                "SAMPLESTART",
                0,
            ),

            sampleLengthSeconds: this.parseNumberTag(
                normalizedContents,
                "SAMPLELENGTH",
                0,
            ),

            bpmSegments: this.parseBpms(normalizedContents),
            charts: this.parseCharts(normalizedContents),
        };
    }

    private getTagValue(
        contents: string,
        tagName: string,
    ): string {
        const expression = new RegExp(
            `#${tagName}\\s*:\\s*([^;]*);`,
            "i",
        );

        const match = contents.match(expression);

        return match?.[1]?.trim() ?? "";
    }

    private parseNumberTag(
        contents: string,
        tagName: string,
        fallback: number,
    ): number {
        const rawValue = this.getTagValue(
            contents,
            tagName,
        );

        if (rawValue === "") {
            return fallback;
        }

        const value = Number.parseFloat(rawValue);

        return Number.isFinite(value)
            ? value
            : fallback;
    }

    private parseBpms(contents: string): BpmSegment[] {
        const rawBpms = this.getTagValue(
            contents,
            "BPMS",
        );

        if (!rawBpms) {
            return [];
        }

        const segments = rawBpms
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
                const [rawBeat, rawBpm] =
                    entry.split("=");

                const beat = Number.parseFloat(
                    rawBeat ?? "",
                );

                const bpm = Number.parseFloat(
                    rawBpm ?? "",
                );

                if (
                    !Number.isFinite(beat) ||
                    !Number.isFinite(bpm) ||
                    bpm <= 0
                ) {
                    throw new Error(
                        `Invalid BPM segment: "${entry}"`,
                    );
                }

                return {
                    beat,
                    bpm,
                };
            });

        return segments.sort(
            (left, right) => left.beat - right.beat,
        );
    }

    private parseCharts(
        contents: string,
    ): StepManiaChart[] {
        const charts: StepManiaChart[] = [];

        const notesExpression =
            /#NOTES\s*:\s*([\s\S]*?);/gi;

        let match: RegExpExecArray | null;

        while (
            (match = notesExpression.exec(contents)) !== null
        ) {
            const notesBlock = match[1];

            if (!notesBlock) {
                continue;
            }

            const chart = this.parseNotesBlock(
                notesBlock,
            );

            if (chart) {
                charts.push(chart);
            }
        }

        return charts;
    }

    private parseNotesBlock(
        notesBlock: string,
    ): StepManiaChart | null {
        const fields = notesBlock.split(":");

        if (fields.length < 6) {
            console.warn(
                "Skipping malformed #NOTES block.",
            );

            return null;
        }

        const stepType = fields[0]?.trim() ?? "";
        const description = fields[1]?.trim() ?? "";
        const difficulty = fields[2]?.trim() ?? "";

        const meterValue = Number.parseInt(
            fields[3]?.trim() ?? "",
            10,
        );

        const radarValues = this.parseRadarValues(
            fields[4] ?? "",
        );

        /*
         * The note-data portion can theoretically contain colons in
         * unusual comments or metadata, so join the remaining fields.
         */
        const noteData = fields
            .slice(5)
            .join(":")
            .trim();

        if (stepType.toLowerCase() !== "dance-single") {
            return null;
        }

        return {
            stepType,
            description,
            difficulty,
            meter: Number.isFinite(meterValue)
                ? meterValue
                : 0,
            radarValues,
            notes: this.parseNoteData(noteData),
        };
    }

    private parseRadarValues(
        rawRadarValues: string,
    ): number[] {
        return rawRadarValues
            .split(",")
            .map((value) => Number.parseFloat(value.trim()))
            .filter((value) => Number.isFinite(value));
    }

    private parseNoteData(
        noteData: string,
    ): ParsedChartNote[] {
        const measures = noteData.split(",");
        const notes: ParsedChartNote[] = [];

        for (
            let measureIndex = 0;
            measureIndex < measures.length;
            measureIndex += 1
        ) {
            const measure = measures[measureIndex];

            if (measure === undefined) {
                continue;
            }

            const rows = this.getMeasureRows(measure);

            if (rows.length === 0) {
                continue;
            }

            for (
                let rowIndex = 0;
                rowIndex < rows.length;
                rowIndex += 1
            ) {
                const row = rows[rowIndex];

                if (!row) {
                    continue;
                }

                const beat =
                    measureIndex * BEATS_PER_MEASURE +
                    rowIndex *
                        (BEATS_PER_MEASURE / rows.length);

                this.parseRow(
                    row,
                    beat,
                    notes,
                );
            }
        }

        return notes;
    }

    private getMeasureRows(
        measure: string,
    ): string[] {
        return measure
            .split("\n")
            .map((line) => {
                /*
                 * Remove StepMania-style line comments.
                 */
                const commentIndex = line.indexOf("//");

                const withoutComment =
                    commentIndex >= 0
                        ? line.slice(0, commentIndex)
                        : line;

                return withoutComment.trim();
            })
            .filter(Boolean)
            .filter((row) => {
                if (row.length !== LANES_PER_ROW) {
                    console.warn(
                        `Skipping malformed note row: "${row}"`,
                    );

                    return false;
                }

                return true;
            });
    }

    private parseRow(
        row: string,
        beat: number,
        notes: ParsedChartNote[],
    ): void {
        for (
            let laneIndex = 0;
            laneIndex < LANES_PER_ROW;
            laneIndex += 1
        ) {
            const symbol = row[laneIndex];

            /*
             * Initial support:
             * 0 = empty
             * 1 = tap
             *
             * Symbols such as 2, 3, 4, M, and L will be handled later.
             */
            if (symbol !== "1") {
                continue;
            }

            notes.push({
                lane: laneIndex as Lane,
                beat,
            });
        }
    }
}