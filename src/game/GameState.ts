import type { JudgmentResult } from "../types/Judgment";
import type { TapNote } from "../types/Note";
import type { ScoreState } from "./ScoringSystem";

export type GameStatus =
    | "idle"
    | "playing"
    | "paused"
    | "finished";

export interface GameState {
    status: GameStatus;
    gameTimeSeconds: number;
    notes: TapNote[];

    score: ScoreState;
    lastJudgment: JudgmentResult | null;
}