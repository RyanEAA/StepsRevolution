import type {
    RuntimeChartNote,
    StepManiaChart,
    StepManiaSimfile,
} from "../types/Chart";
import { TimingMap } from "./TimingMap";

export class RuntimeChartBuilder {
    public build(
        simfile: StepManiaSimfile,
        chart: StepManiaChart,
    ): RuntimeChartNote[] {
        const timingMap = new TimingMap(
            simfile.bpmSegments,
            simfile.offsetSeconds,
        );

        return chart.notes
            .map((note) => ({
                lane: note.lane,
                beat: note.beat,
                hitTimeSeconds:
                    timingMap.beatToSeconds(note.beat),
            }))
            .sort(
                (left, right) =>
                    left.hitTimeSeconds -
                    right.hitTimeSeconds,
            );
    }
}