import type { FootState } from "../types/FootState";
import { JudgmentSystem } from "./JudgmentSystem";
import { NoteManager } from "./NoteManager";
import type { ChartNoteDefinition } from "./NoteManager";
import { ScoringSystem } from "./ScoringSystem";
import type { GameState } from "./GameState";
import type { TapNote } from "../types/Note";

const TEST_CHART: readonly ChartNoteDefinition[] = [
    { lane: 0, hitTimeSeconds: 2.0 },
    { lane: 1, hitTimeSeconds: 2.5 },
    { lane: 2, hitTimeSeconds: 3.0 },
    { lane: 3, hitTimeSeconds: 3.5 },

    { lane: 0, hitTimeSeconds: 4.0 },
    { lane: 3, hitTimeSeconds: 4.5 },
    { lane: 1, hitTimeSeconds: 5.0 },
    { lane: 2, hitTimeSeconds: 5.5 },

    { lane: 0, hitTimeSeconds: 6.0 },
    { lane: 1, hitTimeSeconds: 6.25 },
    { lane: 2, hitTimeSeconds: 6.5 },
    { lane: 3, hitTimeSeconds: 6.75 },

    { lane: 3, hitTimeSeconds: 7.5 },
    { lane: 2, hitTimeSeconds: 8.0 },
    { lane: 1, hitTimeSeconds: 8.5 },
    { lane: 0, hitTimeSeconds: 9.0 },

    { lane: 0, hitTimeSeconds: 10.0 },
    { lane: 2, hitTimeSeconds: 10.0 },

    { lane: 1, hitTimeSeconds: 11.0 },
    { lane: 3, hitTimeSeconds: 11.0 },

    { lane: 0, hitTimeSeconds: 12.0 },
    { lane: 1, hitTimeSeconds: 12.5 },
    { lane: 2, hitTimeSeconds: 13.0 },
    { lane: 3, hitTimeSeconds: 13.5 },
];

const FINISH_TIME_SECONDS = 14.5;
const JUDGED_NOTE_REMOVAL_DELAY_SECONDS = 0.45;

export class Game {
    private readonly noteManager = new NoteManager();
    private readonly judgmentSystem = new JudgmentSystem();
    private readonly scoringSystem = new ScoringSystem();

    private state: GameState = this.createInitialState();

    public start(): void {
        this.scoringSystem.reset();

        this.state = {
            status: "playing",
            gameTimeSeconds: 0,
            notes: this.noteManager.createNotes(TEST_CHART),
            score: { ...this.scoringSystem.getState() },
            lastJudgment: null,
        };
    }

    public restart(): void {
        this.start();
    }

    public pause(): void {
        if (this.state.status !== "playing") {
            return;
        }

        this.state.status = "paused";
    }

    public resume(): void {
        if (this.state.status !== "paused") {
            return;
        }

        this.state.status = "playing";
    }

    public togglePause(): void {
        if (this.state.status === "playing") {
            this.pause();
            return;
        }

        if (this.state.status === "paused") {
            this.resume();
        }
    }

    public update(
        songTimeSeconds: number,
        footState: FootState,
    ): void {
        if (this.state.status !== "playing") {
            return;
        }

        this.state.gameTimeSeconds = Math.max(
            0,
            songTimeSeconds,
        );

        const judgmentResults = this.judgmentSystem.update(
            this.state.notes,
            footState,
            this.state.gameTimeSeconds,
        );

        if (judgmentResults.length > 0) {
            this.scoringSystem.applyResults(judgmentResults);

            this.state.score = {
                ...this.scoringSystem.getState(),
            };

            this.state.lastJudgment =
                judgmentResults[judgmentResults.length - 1] ?? null;
        }

        this.state.notes =
            this.noteManager.removeFinishedNotes(
                this.state.notes,
                this.state.gameTimeSeconds,
                JUDGED_NOTE_REMOVAL_DELAY_SECONDS,
            );

        if (
            this.state.notes.length === 0 &&
            this.state.gameTimeSeconds >= FINISH_TIME_SECONDS
        ) {
            this.state.status = "finished";
        }
    }

    public getState(): Readonly<GameState> {
        return this.state;
    }

    public getVisibleNotes(): readonly TapNote[] {
        return this.state.notes;
    }

    private createInitialState(): GameState {
        return {
            status: "idle",
            gameTimeSeconds: 0,
            notes: [],
            score: { ...this.scoringSystem.getState() },
            lastJudgment: null,
        };
    }

    public reset(): void {
        this.scoringSystem.reset();

        this.state = {
            status: "idle",
            gameTimeSeconds: 0,
            notes: [],
            score: { ...this.scoringSystem.getState() },
            lastJudgment: null,
        };
    }
}