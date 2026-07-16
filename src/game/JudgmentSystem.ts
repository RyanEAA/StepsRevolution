import type { FootState } from "../types/FootState";
import type {
    JudgmentName,
    JudgmentResult,
} from "../types/Judgment";
import type { Lane, TapNote } from "../types/Note";

const LANE_COUNT = 4;

export const JUDGMENT_WINDOWS = {
    perfect: 0.08,
    great: 0.15,
    good: 0.25,
} as const;

export class JudgmentSystem {
    public update(
        notes: TapNote[],
        footState: FootState,
        gameTimeSeconds: number,
    ): JudgmentResult[] {
        const results: JudgmentResult[] = [];

        for (const note of notes) {
            if (note.judged) {
                continue;
            }

            const timingErrorSeconds =
                gameTimeSeconds - note.hitTimeSeconds;

            /*
             * A foot may enter the lane early, but we do not judge the
             * note until its scheduled hit time has arrived.
             */
            if (timingErrorSeconds < 0) {
                continue;
            }

            const correctPlacement = this.canEitherFootHitLane(
                footState,
                note.lane,
            );

            if (
                correctPlacement &&
                timingErrorSeconds <= JUDGMENT_WINDOWS.good
            ) {
                const judgment =
                    this.getHitJudgment(timingErrorSeconds);

                note.judged = true;
                note.judgment = judgment;

                results.push({
                    noteId: note.id,
                    lane: note.lane,
                    judgment,
                    timingErrorSeconds,
                    judgedAtGameTimeSeconds: gameTimeSeconds,
                });

                continue;
            }

            if (timingErrorSeconds > JUDGMENT_WINDOWS.good) {
                note.judged = true;
                note.judgment = "miss";

                results.push({
                    noteId: note.id,
                    lane: note.lane,
                    judgment: "miss",
                    timingErrorSeconds,
                    judgedAtGameTimeSeconds: gameTimeSeconds,
                });
            }
        }

        return results;
    }

    private getHitJudgment(
        timingErrorSeconds: number,
    ): Exclude<JudgmentName, "miss"> {
        if (timingErrorSeconds <= JUDGMENT_WINDOWS.perfect) {
            return "perfect";
        }

        if (timingErrorSeconds <= JUDGMENT_WINDOWS.great) {
            return "great";
        }

        return "good";
    }

    private canEitherFootHitLane(
        footState: FootState,
        noteLane: Lane,
    ): boolean {
        return (
            this.footCanHitLane(
                footState.leftX,
                footState.leftVisible,
                noteLane,
            ) ||
            this.footCanHitLane(
                footState.rightX,
                footState.rightVisible,
                noteLane,
            )
        );
    }

    private footCanHitLane(
        normalizedX: number,
        visible: boolean,
        noteLane: Lane,
    ): boolean {
        if (!visible) {
            return false;
        }

        return this.positionToLane(normalizedX) === noteLane;
    }

    private positionToLane(normalizedX: number): Lane {
        const rawLane = Math.floor(normalizedX * LANE_COUNT);

        return this.clamp(
            rawLane,
            0,
            LANE_COUNT - 1,
        ) as Lane;
    }

    private clamp(
        value: number,
        minimum: number,
        maximum: number,
    ): number {
        return Math.min(
            Math.max(value, minimum),
            maximum,
        );
    }
}