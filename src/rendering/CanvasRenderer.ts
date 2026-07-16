import type { FootState } from "../types/FootState";
import type { JudgmentName } from "../types/Judgment";
import type { Lane, TapNote } from "../types/Note";
import type { GameState } from "../game/GameState";

const NOTE_APPROACH_SECONDS = 2.5;
const NOTE_RADIUS_MIN = 18;
const NOTE_RADIUS_MAX = 34;

const LANE_COUNT = 4;

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

export class CanvasRenderer {
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D;

    private cssWidth = 0;
    private cssHeight = 0;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error(
                "Your browser does not support the Canvas 2D rendering context.",
            );
        }

        this.context = context;
        this.resize();
    }

    public resize(): void {
        const rectangle = this.canvas.getBoundingClientRect();
        const pixelRatio = window.devicePixelRatio || 1;

        this.cssWidth = rectangle.width;
        this.cssHeight = rectangle.height;

        this.canvas.width = Math.round(rectangle.width * pixelRatio);
        this.canvas.height = Math.round(rectangle.height * pixelRatio);

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
    }

    public render(
        footState: FootState,
        notes: readonly TapNote[],
        gameState: Readonly<GameState>,
        framesPerSecond: number,
    ): void {
        this.clearCanvas();
        this.drawBackground();
        this.drawLanes();

        this.drawNotes(
            notes,
            gameState.gameTimeSeconds,
        );

        this.drawJudgmentLine();
        this.drawFeet(footState);

        this.drawGameHud(gameState);

        this.drawDebugPanel(
            footState,
            gameState,
            framesPerSecond,
        );
    }

    private drawBackground(): void {
        const gradient = this.context.createLinearGradient(
            0,
            0,
            0,
            this.cssHeight,
        );

        gradient.addColorStop(0, "#121a2c");
        gradient.addColorStop(1, "#080c16");

        this.context.fillStyle = gradient;
        this.context.fillRect(
            0,
            0,
            this.cssWidth,
            this.cssHeight,
        );
    }

    private drawLanes(): void {
        const laneWidth = this.cssWidth / LANE_COUNT;

        for (let laneIndex = 0; laneIndex < LANE_COUNT; laneIndex += 1) {
            const laneX = laneIndex * laneWidth;

            this.context.fillStyle =
                laneIndex % 2 === 0
                    ? "rgba(255, 255, 255, 0.025)"
                    : "rgba(255, 255, 255, 0.055)";

            this.context.fillRect(
                laneX,
                0,
                laneWidth,
                this.cssHeight,
            );

            this.drawLaneHeading(
                laneIndex as Lane,
                laneX,
                laneWidth,
            );
        }

        this.context.strokeStyle = "rgba(255, 255, 255, 0.2)";
        this.context.lineWidth = 2;

        for (let dividerIndex = 1; dividerIndex < LANE_COUNT; dividerIndex += 1) {
            const dividerX = dividerIndex * laneWidth;

            this.context.beginPath();
            this.context.moveTo(dividerX, 0);
            this.context.lineTo(dividerX, this.cssHeight);
            this.context.stroke();
        }
    }

    private drawLaneHeading(
        lane: Lane,
        laneX: number,
        laneWidth: number,
    ): void {
        const centerX = laneX + laneWidth / 2;

        this.context.textAlign = "center";
        this.context.textBaseline = "middle";

        this.context.fillStyle = "rgba(255, 255, 255, 0.9)";
        this.context.font =
            `700 ${this.clamp(laneWidth * 0.22, 28, 52)}px system-ui`;

        this.context.fillText(
            LANE_SYMBOLS[lane],
            centerX,
            48,
        );

        this.context.fillStyle = "rgba(255, 255, 255, 0.55)";
        this.context.font =
            `600 ${this.clamp(laneWidth * 0.065, 10, 14)}px system-ui`;

        this.context.fillText(
            LANE_LABELS[lane],
            centerX,
            82,
        );
    }

    private drawJudgmentLine(): void {
        const judgmentLineY = this.getJudgmentLineY();

        this.context.save();

        this.context.shadowBlur = 14;
        this.context.shadowColor = "rgba(255, 255, 255, 0.55)";

        this.context.strokeStyle = "rgba(255, 255, 255, 0.95)";
        this.context.lineWidth = 4;

        this.context.beginPath();
        this.context.moveTo(0, judgmentLineY);
        this.context.lineTo(this.cssWidth, judgmentLineY);
        this.context.stroke();

        this.context.restore();

        this.context.fillStyle = "rgba(255, 255, 255, 0.75)";
        this.context.font = "600 11px system-ui";
        this.context.textAlign = "left";
        this.context.textBaseline = "bottom";

        this.context.fillText(
            "JUDGMENT LINE",
            12,
            judgmentLineY - 10,
        );
    }

    private drawFeet(footState: FootState): void {
        const footY = this.getJudgmentLineY() + 44;

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
        const radius = this.clamp(this.cssWidth * 0.022, 18, 28);

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

    private drawDebugPanel(
        footState: FootState,
        gameState: Readonly<GameState>,
        framesPerSecond: number,
    ): void {
        const leftLane = this.positionToLane(footState.leftX);
        const rightLane = this.positionToLane(footState.rightX);

        const panelX = 14;
        const panelY = 104;
        const panelWidth = Math.min(330, this.cssWidth - 28);
        const panelHeight = 168;

        this.context.fillStyle = "rgba(3, 7, 14, 0.78)";
        this.context.fillRect(
            panelX,
            panelY,
            panelWidth,
            panelHeight,
        );

        this.context.strokeStyle = "rgba(255, 255, 255, 0.14)";
        this.context.lineWidth = 1;
        this.context.strokeRect(
            panelX,
            panelY,
            panelWidth,
            panelHeight,
        );

        this.context.textAlign = "left";
        this.context.textBaseline = "top";

        this.context.fillStyle = "rgba(255, 255, 255, 0.55)";
        this.context.font = "600 11px ui-monospace, monospace";
        this.context.fillText("DEBUG", panelX + 14, panelY + 12);

        this.context.fillStyle = "rgba(255, 255, 255, 0.55)";
        this.context.font = "600 11px ui-monospace, monospace";

        this.context.fillText(
            "DEBUG",
            panelX + 14,
            panelY + 12,
        );

        this.context.fillStyle = "#5ee7ff";
        this.context.font = "600 14px ui-monospace, monospace";

        this.context.fillText(
            `Left:  x=${footState.leftX.toFixed(3)}  lane=${leftLane}`,
            panelX + 14,
            panelY + 38,
        );

        this.context.fillStyle = "#ff76cf";

        this.context.fillText(
            `Right: x=${footState.rightX.toFixed(3)}  lane=${rightLane}`,
            panelX + 14,
            panelY + 63,
        );

        this.context.fillStyle = "rgba(255, 255, 255, 0.75)";

        this.context.fillText(
            `Time: ${gameState.gameTimeSeconds.toFixed(3)} s`,
            panelX + 14,
            panelY + 88,
        );

        this.context.fillText(
            `Status: ${gameState.status}`,
            panelX + 14,
            panelY + 113,
        );

        this.context.fillText(
            `FPS: ${framesPerSecond.toFixed(1)}`,
            panelX + 14,
            panelY + 138,
        );
    }

    private getJudgmentLineY(): number {
        return this.cssHeight * 0.78;
    }

    private positionToLane(normalizedX: number): Lane {
        const lane = Math.floor(normalizedX * LANE_COUNT);

        /*
         * A normalized position of exactly 1.0 would otherwise produce lane 4.
         */
        return this.clamp(lane, 0, LANE_COUNT - 1) as Lane;
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
                continue;
            }

            const noteY = this.calculateNoteY(secondsUntilHit);

            if (noteY < -60 || noteY > this.cssHeight + 60) {
                continue;
            }

            this.drawTapNote(note.lane, noteY);
        }
    }

    private calculateNoteY(secondsUntilHit: number): number {
        const judgmentLineY = this.getJudgmentLineY();

        /*
        * At NOTE_APPROACH_SECONDS before the hit, progress is 0 and the
        * note is at the top.
        *
        * At 0 seconds before the hit, progress is 1 and the note reaches
        * the judgment line.
        */
        const progress =
            1 - secondsUntilHit / NOTE_APPROACH_SECONDS;

        return progress * judgmentLineY;
    }

    private drawTapNote(lane: Lane, y: number): void {
        const laneWidth = this.cssWidth / LANE_COUNT;
        const centerX = laneWidth * lane + laneWidth / 2;

        const noteRadius = this.clamp(
            laneWidth * 0.16,
            NOTE_RADIUS_MIN,
            NOTE_RADIUS_MAX,
        );

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
        const judgmentY = this.getJudgmentLineY() - 92;

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
}