import type { FootState } from "../types/FootState";

export type Lane = 0 | 1 | 2 | 3;

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

    public render(footState: FootState, framesPerSecond: number): void {
        this.clearCanvas();
        this.drawBackground();
        this.drawLanes();
        this.drawJudgmentLine();
        this.drawFeet(footState);
        this.drawDebugPanel(footState, framesPerSecond);
    }

    private clearCanvas(): void {
        this.context.clearRect(
            0,
            0,
            this.cssWidth,
            this.cssHeight,
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
        framesPerSecond: number,
    ): void {
        const leftLane = this.positionToLane(footState.leftX);
        const rightLane = this.positionToLane(footState.rightX);

        const panelX = 14;
        const panelY = 104;
        const panelWidth = Math.min(330, this.cssWidth - 28);
        const panelHeight = 118;

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

        this.context.fillStyle = "rgba(255, 255, 255, 0.7)";
        this.context.fillText(
            `FPS: ${framesPerSecond.toFixed(1)}`,
            panelX + 14,
            panelY + 88,
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
}