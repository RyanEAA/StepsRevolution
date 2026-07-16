import type { Lane } from "./Note";

export type JudgmentName =
    | "perfect"
    | "great"
    | "good"
    | "miss";

export interface JudgmentResult {
    noteId: number;
    lane: Lane;
    judgment: JudgmentName;

    /**
     * Positive values mean the note was judged late.
     *
     * The current placement-based system does not judge notes early.
     */
    timingErrorSeconds: number;

    judgedAtGameTimeSeconds: number;
}