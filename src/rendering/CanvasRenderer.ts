import type { FootState } from "../types/FootState";
import type { JudgmentName } from "../types/Judgment";
import type { Lane, TapNote } from "../types/Note";
import type { GameState } from "../game/GameState";

const NOTE_APPROACH_SECONDS = 2.5;
const NOTE_RADIUS_MIN = 18;
const NOTE_RADIUS_MAX = 34;

const LANE_COUNT = 4;
const RENDER_SAMPLE_COUNT = 120;
const RENDER_BUDGET_MS = 8;

const LANE_LABELS = [
    "LEFT",
    "DOWN",
    "UP",
    "RIGHT",
] as const;

const LANE_SYMBOLS = [
    "←",
    "↓",
    "↑",
    "→",
] as const;

export interface RendererPerformanceStats {
    averageMs: number;
    percentile95Ms: number;
    maximumMs: number;
    framesOverBudget: number;
    sampleCount: number;
}

export class CanvasRenderer {
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D;
    private readonly staticCanvas: HTMLCanvasElement;
    private readonly staticContext: CanvasRenderingContext2D;

    private readonly renderSamples =
        new Float64Array(RENDER_SAMPLE_COUNT);

    private renderSampleIndex = 0;
    private renderSampleCount = 0;

    private cssWidth = 0;
    private cssHeight = 0;
    private laneWidth = 0;
    private judgmentLineY = 0;
    private noteRadius = NOTE_RADIUS_MIN;
    private footRadius = NOTE_RADIUS_MIN;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error(
                "Your browser does not support the Canvas 2D rendering context.",
            );
        }

        this.context = context;

        this.staticCanvas = document.createElement("canvas");

        const staticContext =
            this.staticCanvas.getContext("2d");

        if (!staticContext) {
            throw new Error(
                "Your browser does not support an offscreen Canvas 2D rendering context.",
            );
        }

        this.staticContext = staticContext;
        this.resize();
    }

    public resize(): void {
        const rectangle = this.canvas.getBoundingClientRect();
        const pixelRatio = window.devicePixelRatio || 1;

        this.cssWidth = rectangle.width;
        this.cssHeight = rectangle.height;

        this.updateLayoutGeometry();

        this.canvas.width = Math.round(rectangle.width * pixelRatio);
        this.canvas.height = Math.round(rectangle.height * pixelRatio);

        this.staticCanvas.width = this.canvas.width;
        this.staticCanvas.height = this.canvas.height;

        /*
         * Drawing commands can continue using CSS pixel measurements even
         * though the backing canvas is larger on high-density screens.
         */
        this.context.setTransform(
            pixelRatio,
            0,
            0,
            pixelRatio,
            0,
            0,
        );

        this.staticContext.setTransform(
            pixelRatio,
            0,
            0,
            pixelRatio,
            0,
            0,
        );

        this.renderStaticLayer();
    }

    public render(
        footState: FootState,
        notes: readonly TapNote[],
        gameState: Readonly<GameState>,
    ): void {
        /*
         * The gameplay view starts hidden, so its first measured size can be
         * zero. A zero-sized canvas is safe to clear or draw into, but using
         * it as a drawImage() source throws and would stop the game loop
         * before the visible-view resize runs.
         */
        if (
            this.cssWidth <= 0 ||
            this.cssHeight <= 0 ||
            this.staticCanvas.width <= 0 ||
            this.staticCanvas.height <= 0
        ) {
            return;
        }

        const renderStartTimeMs = performance.now();

        this.clearCanvas();
        this.drawStaticLayer();

        this.drawNotes(
            notes,
            gameState.gameTimeSeconds,
        );

        this.drawFeet(footState);

        this.drawGameHud(gameState);
        this.recordRenderDuration(
            performance.now() - renderStartTimeMs,
        );
    }

    public getPerformanceStats(): RendererPerformanceStats {
        if (this.renderSampleCount === 0) {
            return {
                averageMs: 0,
                percentile95Ms: 0,
                maximumMs: 0,
                framesOverBudget: 0,
                sampleCount: 0,
            };
        }

        const samples = Array.from(
            this.renderSamples.subarray(
                0,
                this.renderSampleCount,
            ),
        ).sort((left, right) => left - right);

        let totalMs = 0;
        let framesOverBudget = 0;

        for (const sample of samples) {
            totalMs += sample;

            if (sample > RENDER_BUDGET_MS) {
                framesOverBudget += 1;
            }
        }

        const percentile95Index = Math.min(
            samples.length - 1,
            Math.ceil(samples.length * 0.95) - 1,
        );

        return {
            averageMs: totalMs / samples.length,
            percentile95Ms:
                samples[percentile95Index] ?? 0,
            maximumMs: samples.at(-1) ?? 0,
            framesOverBudget,
            sampleCount: samples.length,
        };
    }

    private drawBackground(
        context: CanvasRenderingContext2D,
    ): void {
        const gradient = context.createLinearGradient(
            0,
            0,
            0,
            this.cssHeight,
        );

        gradient.addColorStop(
            0,
            "rgba(18,26,44,0.55)",
        );

        gradient.addColorStop(
            1,
            "rgba(8,12,22,0.55)",
        );

        context.fillStyle = gradient;
        context.fillRect(
            0,
            0,
            this.cssWidth,
            this.cssHeight,
        );
    }

    private drawLanes(
        context: CanvasRenderingContext2D,
    ): void {
        for (let laneIndex = 0; laneIndex < LANE_COUNT; laneIndex += 1) {
            const laneX = laneIndex * this.laneWidth;

            context.fillStyle =
                laneIndex % 2 === 0
                    ? "rgba(255, 255, 255, 0.025)"
                    : "rgba(255, 255, 255, 0.055)";

            context.fillRect(
                laneX,
                0,
                this.laneWidth,
                this.cssHeight,
            );

            this.drawLaneHeading(
                context,
                laneIndex as Lane,
                laneX,
                this.laneWidth,
            );
        }

        context.strokeStyle = "rgba(255, 255, 255, 0.2)";
        context.lineWidth = 2;

        for (let dividerIndex = 1; dividerIndex < LANE_COUNT; dividerIndex += 1) {
            const dividerX = dividerIndex * this.laneWidth;

            context.beginPath();
            context.moveTo(dividerX, 0);
            context.lineTo(dividerX, this.cssHeight);
            context.stroke();
        }
    }

    private drawLaneHeading(
        context: CanvasRenderingContext2D,
        lane: Lane,
        laneX: number,
        laneWidth: number,
    ): void {
        const centerX = laneX + laneWidth / 2;

        context.textAlign = "center";
        context.textBaseline = "middle";

        context.fillStyle = "rgba(255, 255, 255, 0.9)";
        context.font =
            `700 ${this.clamp(laneWidth * 0.22, 28, 52)}px system-ui`;

        context.fillText(
            LANE_SYMBOLS[lane],
            centerX,
            48,
        );

        context.fillStyle = "rgba(255, 255, 255, 0.55)";
        context.font =
            `600 ${this.clamp(laneWidth * 0.065, 10, 14)}px system-ui`;

        context.fillText(
            LANE_LABELS[lane],
            centerX,
            82,
        );
    }

    private drawJudgmentLine(
        context: CanvasRenderingContext2D,
    ): void {
        context.save();

        context.shadowBlur = 14;
        context.shadowColor = "rgba(255, 255, 255, 0.55)";

        context.strokeStyle = "rgba(255, 255, 255, 0.95)";
        context.lineWidth = 4;

        context.beginPath();
        context.moveTo(0, this.judgmentLineY);
        context.lineTo(this.cssWidth, this.judgmentLineY);
        context.stroke();

        context.restore();

        context.fillStyle = "rgba(255, 255, 255, 0.75)";
        context.font = "600 11px system-ui";
        context.textAlign = "left";
        context.textBaseline = "bottom";

        context.fillText(
            "JUDGMENT LINE",
            12,
            this.judgmentLineY - 10,
        );
    }

    private drawFeet(footState: FootState): void {
        const footY = this.judgmentLineY + 44;

        if (footState.leftVisible) {
            this.drawFootDot(
                footState.leftX,
                footY,
                "L",
                "#5ee7ff",
            );
        }

        if (footState.rightVisible) {
            this.drawFootDot(
                footState.rightX,
                footY,
                "R",
                "#ff76cf",
            );
        }
    }

    private drawFootDot(
        normalizedX: number,
        y: number,
        label: string,
        color: string,
    ): void {
        const x = normalizedX * this.cssWidth;
        const radius = this.footRadius;

        this.context.save();

        this.context.shadowBlur = 20;
        this.context.shadowColor = color;

        this.context.beginPath();
        this.context.arc(
            x,
            y,
            radius,
            0,
            Math.PI * 2,
        );

        this.context.fillStyle = color;
        this.context.fill();

        this.context.restore();

        this.context.beginPath();
        this.context.arc(
            x,
            y,
            radius - 5,
            0,
            Math.PI * 2,
        );

        this.context.strokeStyle = "rgba(5, 10, 20, 0.8)";
        this.context.lineWidth = 3;
        this.context.stroke();

        this.context.fillStyle = "#06101a";
        this.context.font = `800 ${radius}px system-ui`;
        this.context.textAlign = "center";
        this.context.textBaseline = "middle";

        this.context.fillText(
            label,
            x,
            y + 1,
        );
    }

    private clamp(value: number, minimum: number, maximum: number): number {
        return Math.min(Math.max(value, minimum), maximum);
    }


    private drawNotes(
        notes: readonly TapNote[],
        gameTimeSeconds: number,
    ): void {
        for (const note of notes) {
            if (note.judged) {
                continue;
            }

            const secondsUntilHit =
                note.hitTimeSeconds - gameTimeSeconds;

            if (secondsUntilHit > NOTE_APPROACH_SECONDS) {
                break;
            }

            const noteY = this.calculateNoteY(secondsUntilHit);

            if (noteY < -60 || noteY > this.cssHeight + 60) {
                continue;
            }

            this.drawTapNote(note.lane, noteY);
        }
    }

    private calculateNoteY(secondsUntilHit: number): number {
        /*
        * At NOTE_APPROACH_SECONDS before the hit, progress is 0 and the
        * note is at the top.
        *
        * At 0 seconds before the hit, progress is 1 and the note reaches
        * the judgment line.
        */
        const progress =
            1 - secondsUntilHit / NOTE_APPROACH_SECONDS;

        return progress * this.judgmentLineY;
    }

    private drawTapNote(lane: Lane, y: number): void {
        const centerX =
            this.laneWidth * lane + this.laneWidth / 2;

        const noteRadius = this.noteRadius;

        this.context.save();

        this.context.shadowBlur = 18;
        this.context.shadowColor = "rgba(132, 181, 255, 0.9)";

        this.context.beginPath();
        this.context.arc(
            centerX,
            y,
            noteRadius,
            0,
            Math.PI * 2,
        );

        this.context.fillStyle = "#8db5ff";
        this.context.fill();

        this.context.restore();

        this.context.beginPath();
        this.context.arc(
            centerX,
            y,
            noteRadius - 5,
            0,
            Math.PI * 2,
        );

        this.context.fillStyle = "rgba(16, 25, 50, 0.85)";
        this.context.fill();

        this.context.strokeStyle = "rgba(255, 255, 255, 0.9)";
        this.context.lineWidth = 2;
        this.context.stroke();

        this.context.fillStyle = "#ffffff";
        this.context.font =
            `800 ${this.clamp(noteRadius * 1.05, 18, 34)}px system-ui`;

        this.context.textAlign = "center";
        this.context.textBaseline = "middle";

        this.context.fillText(
            LANE_SYMBOLS[lane],
            centerX,
            y + 1,
        );
    }

    private drawGameHud(gameState: Readonly<GameState>): void {
        this.drawScore(gameState);
        this.drawCurrentJudgment(gameState);
    }

    private drawScore(gameState: Readonly<GameState>): void {
        const rightPadding = 22;

        this.context.textAlign = "right";
        this.context.textBaseline = "top";

        this.context.fillStyle = "rgba(255, 255, 255, 0.55)";
        this.context.font = "700 12px system-ui";

        this.context.fillText(
            "SCORE",
            this.cssWidth - rightPadding,
            112,
        );

        this.context.fillStyle = "#ffffff";
        this.context.font = "800 30px system-ui";

        this.context.fillText(
            gameState.score.score.toLocaleString(),
            this.cssWidth - rightPadding,
            130,
        );

        this.context.fillStyle = "rgba(255, 255, 255, 0.55)";
        this.context.font = "700 12px system-ui";

        this.context.fillText(
            "COMBO",
            this.cssWidth - rightPadding,
            176,
        );

        this.context.fillStyle = "#ffffff";
        this.context.font = "800 34px system-ui";

        this.context.fillText(
            gameState.score.combo.toString(),
            this.cssWidth - rightPadding,
            192,
        );
    }

    private drawCurrentJudgment(
        gameState: Readonly<GameState>,
    ): void {
        const result = gameState.lastJudgment;

        if (!result) {
            return;
        }

        const ageSeconds =
            gameState.gameTimeSeconds -
            result.judgedAtGameTimeSeconds;

        const displayDurationSeconds = 0.7;

        if (ageSeconds > displayDurationSeconds) {
            return;
        }

        const opacity =
            1 - ageSeconds / displayDurationSeconds;

        const centerX = this.cssWidth / 2;
        const judgmentY = this.judgmentLineY - 92;

        this.context.save();

        this.context.globalAlpha = opacity;
        this.context.textAlign = "center";
        this.context.textBaseline = "middle";

        this.context.shadowBlur = 18;
        this.context.shadowColor =
            this.getJudgmentColor(result.judgment);

        this.context.fillStyle =
            this.getJudgmentColor(result.judgment);

        this.context.font =
            `900 ${this.clamp(this.cssWidth * 0.05, 34, 64)}px system-ui`;

        this.context.fillText(
            result.judgment.toUpperCase(),
            centerX,
            judgmentY,
        );

        this.context.restore();
    }

    private getJudgmentColor(
        judgment: JudgmentName,
    ): string {
        switch (judgment) {
            case "perfect":
                return "#fff18a";

            case "great":
                return "#83ecff";

            case "good":
                return "#91ff9f";

            case "miss":
                return "#ff7b8a";
        }
    }

    private clearCanvas(): void {
        this.context.clearRect(
            0,
            0,
            this.cssWidth,
            this.cssHeight,
        );
    }

    private updateLayoutGeometry(): void {
        this.laneWidth = this.cssWidth / LANE_COUNT;
        this.judgmentLineY = this.cssHeight * 0.78;

        this.noteRadius = this.clamp(
            this.laneWidth * 0.16,
            NOTE_RADIUS_MIN,
            NOTE_RADIUS_MAX,
        );

        this.footRadius = this.clamp(
            this.cssWidth * 0.022,
            18,
            28,
        );
    }

    private renderStaticLayer(): void {
        this.staticContext.clearRect(
            0,
            0,
            this.cssWidth,
            this.cssHeight,
        );

        this.drawBackground(this.staticContext);
        this.drawLanes(this.staticContext);
        this.drawJudgmentLine(this.staticContext);
    }

    private drawStaticLayer(): void {
        this.context.drawImage(
            this.staticCanvas,
            0,
            0,
            this.staticCanvas.width,
            this.staticCanvas.height,
            0,
            0,
            this.cssWidth,
            this.cssHeight,
        );
    }

    private recordRenderDuration(durationMs: number): void {
        this.renderSamples[this.renderSampleIndex] = durationMs;

        this.renderSampleIndex =
            (this.renderSampleIndex + 1) % RENDER_SAMPLE_COUNT;

        this.renderSampleCount = Math.min(
            this.renderSampleCount + 1,
            RENDER_SAMPLE_COUNT,
        );
    }
}
