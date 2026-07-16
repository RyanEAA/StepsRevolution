import type { FootState } from "../types/FootState";
import type { TapNote } from "../types/Note";

import { JudgmentSystem } from "./JudgmentSystem";
import { NoteManager } from "./NoteManager";
import type {
    ChartNoteDefinition,
} from "./NoteManager";
import { ScoringSystem } from "./ScoringSystem";
import type { GameState } from "./GameState";

const JUDGED_NOTE_REMOVAL_DELAY_SECONDS = 0.45;
const CHART_FINISH_DELAY_SECONDS = 1.0;

export class Game {
    private readonly noteManager =
        new NoteManager();

    private readonly judgmentSystem =
        new JudgmentSystem();

    private readonly scoringSystem =
        new ScoringSystem();

    private loadedChart:
        readonly ChartNoteDefinition[] = [];

    private chartEndTimeSeconds = 0;

    private state: GameState =
        this.createInitialState();

    public loadChart(
        chart: readonly ChartNoteDefinition[],
    ): void {
        this.loadedChart = [...chart].sort(
            (left, right) =>
                left.hitTimeSeconds -
                right.hitTimeSeconds,
        );

        this.chartEndTimeSeconds =
            this.loadedChart.at(-1)
                ?.hitTimeSeconds ?? 0;

        this.reset();
    }

    public hasChart(): boolean {
        return this.loadedChart.length > 0;
    }

    public start(): void {
        if (!this.hasChart()) {
            throw new Error(
                "Load a chart before starting the game.",
            );
        }

        this.scoringSystem.reset();

        this.state = {
            status: "playing",
            gameTimeSeconds: 0,

            notes: this.noteManager.createNotes(
                this.loadedChart,
            ),

            score: {
                ...this.scoringSystem.getState(),
            },

            lastJudgment: null,
        };
    }

    public reset(): void {
        this.scoringSystem.reset();

        this.state = {
            status: "idle",
            gameTimeSeconds: 0,
            notes: [],
            score: {
                ...this.scoringSystem.getState(),
            },
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

        const judgmentResults =
            this.judgmentSystem.update(
                this.state.notes,
                footState,
                this.state.gameTimeSeconds,
            );

        if (judgmentResults.length > 0) {
            this.scoringSystem.applyResults(
                judgmentResults,
            );

            this.state.score = {
                ...this.scoringSystem.getState(),
            };

            this.state.lastJudgment =
                judgmentResults.at(-1) ?? null;
        }

        this.state.notes =
            this.noteManager.removeFinishedNotes(
                this.state.notes,
                this.state.gameTimeSeconds,
                JUDGED_NOTE_REMOVAL_DELAY_SECONDS,
            );

        const finishTime =
            this.chartEndTimeSeconds +
            CHART_FINISH_DELAY_SECONDS;

        if (
            this.state.notes.length === 0 &&
            this.state.gameTimeSeconds >= finishTime
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
            score: {
                ...this.scoringSystem.getState(),
            },
            lastJudgment: null,
        };
    }
}