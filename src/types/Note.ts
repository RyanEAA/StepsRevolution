import type { JudgmentName } from "./Judgment";

export type Lane = 0 | 1 | 2 | 3;

export interface TapNote {
    id: number;
    lane: Lane;
    hitTimeSeconds: number;

    judged: boolean;
    judgment: JudgmentName | null;
}