import type { RoomSelection } from "../../shared/schemas";
import type { StepManiaChart } from "../types/Chart";
import type {
    AvailableChartIdentityRecord,
    SongEntry,
    SongLibrary,
} from "../types/Library";

export type LocalChartAvailabilityStatus =
    | "matching-chart"
    | "song-missing"
    | "chart-missing"
    | "chart-mismatch";

export interface LocalChartMatch {
    song: SongEntry;
    chart: StepManiaChart;
    chartIndex: number;
    identity: AvailableChartIdentityRecord;
}

export interface LocalChartAvailability {
    status: LocalChartAvailabilityStatus;
    selectionRevision: number;
    chartHash: string | null;
    audioReady: boolean;
    match: LocalChartMatch | null;
}

export class ChartAvailabilityIndex {
    private readonly byChartHash =
        new Map<string, LocalChartMatch[]>();

    private readonly bySongId =
        new Map<string, LocalChartMatch[]>();

    private readonly byChartId =
        new Map<string, LocalChartMatch[]>();

    public rebuild(library: SongLibrary): void {
        this.clear();

        for (const pack of library.packs) {
            for (const song of pack.songs) {
                song.chartIdentities.forEach(
                    (identity) => {
                        if (identity.state !== "available") {
                            return;
                        }

                        const chartIndex =
                            identity.chartIndex;

                        const chart =
                            song.simfile.charts[chartIndex];

                        if (!chart) {
                            return;
                        }

                        const match: LocalChartMatch = {
                            song,
                            chart,
                            chartIndex,
                            identity,
                        };

                        this.add(
                            this.byChartHash,
                            identity.chartHash,
                            match,
                        );

                        this.add(
                            this.bySongId,
                            identity.songId,
                            match,
                        );

                        this.add(
                            this.byChartId,
                            identity.chartId,
                            match,
                        );
                    },
                );
            }
        }
    }

    public clear(): void {
        this.byChartHash.clear();
        this.bySongId.clear();
        this.byChartId.clear();
    }

    public findByChartHash(
        chartHash: string,
    ): readonly LocalChartMatch[] {
        return this.byChartHash.get(chartHash) ?? [];
    }

    public checkSelection(
        selection: Pick<
            RoomSelection,
            | "selectionRevision"
            | "songId"
            | "chartId"
            | "chartHash"
        >,
    ): LocalChartAvailability {
        const exactMatch =
            this.byChartHash.get(selection.chartHash)?.[0];

        if (exactMatch) {
            return {
                status: "matching-chart",
                selectionRevision:
                    selection.selectionRevision,
                chartHash: exactMatch.identity.chartHash,
                audioReady: exactMatch.song.audioFile !== null,
                match: exactMatch,
            };
        }

        if (this.byChartId.has(selection.chartId)) {
            return this.unavailable(
                "chart-mismatch",
                selection.selectionRevision,
            );
        }

        if (this.bySongId.has(selection.songId)) {
            return this.unavailable(
                "chart-missing",
                selection.selectionRevision,
            );
        }

        return this.unavailable(
            "song-missing",
            selection.selectionRevision,
        );
    }

    private add(
        index: Map<string, LocalChartMatch[]>,
        key: string,
        match: LocalChartMatch,
    ): void {
        const matches = index.get(key);

        if (matches) {
            matches.push(match);
        } else {
            index.set(key, [match]);
        }
    }

    private unavailable(
        status: Exclude<
            LocalChartAvailabilityStatus,
            "matching-chart"
        >,
        selectionRevision: number,
    ): LocalChartAvailability {
        return {
            status,
            selectionRevision,
            chartHash: null,
            audioReady: false,
            match: null,
        };
    }
}
