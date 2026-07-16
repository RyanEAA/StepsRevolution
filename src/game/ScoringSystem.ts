import type {
    JudgmentName,
    JudgmentResult,
} from "../types/Judgment";

const JUDGMENT_SCORES: Record<JudgmentName, number> = {
    perfect: 1000,
    great: 600,
    good: 300,
    miss: 0,
};

export interface ScoreState {
    score: number;
    combo: number;
    maxCombo: number;

    perfectCount: number;
    greatCount: number;
    goodCount: number;
    missCount: number;
}

export class ScoringSystem {
    private state: ScoreState = this.createInitialState();

    public reset(): void {
        this.state = this.createInitialState();
    }

    public applyResults(
        results: readonly JudgmentResult[],
    ): void {
        for (const result of results) {
            this.applyJudgment(result.judgment);
        }
    }

    public getState(): Readonly<ScoreState> {
        return this.state;
    }

    private applyJudgment(judgment: JudgmentName): void {
        this.state.score += JUDGMENT_SCORES[judgment];

        switch (judgment) {
            case "perfect":
                this.state.perfectCount += 1;
                this.increaseCombo();
                break;

            case "great":
                this.state.greatCount += 1;
                this.increaseCombo();
                break;

            case "good":
                this.state.goodCount += 1;
                this.increaseCombo();
                break;

            case "miss":
                this.state.missCount += 1;
                this.state.combo = 0;
                break;
        }
    }

    private increaseCombo(): void {
        this.state.combo += 1;

        this.state.maxCombo = Math.max(
            this.state.maxCombo,
            this.state.combo,
        );
    }

    private createInitialState(): ScoreState {
        return {
            score: 0,
            combo: 0,
            maxCombo: 0,

            perfectCount: 0,
            greatCount: 0,
            goodCount: 0,
            missCount: 0,
        };
    }
}