import type {
    PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

const LEFT_FOOT_INDICES = [
    27,
    29,
    31,
] as const;

const RIGHT_FOOT_INDICES = [
    28,
    30,
    32,
] as const;

const FOOT_CONNECTIONS = [
    [27, 29],
    [29, 31],
    [27, 31],
    [28, 30],
    [30, 32],
    [28, 32],
] as const;

type PoseLandmarks =
    PoseLandmarkerResult["landmarks"][number];

interface CanvasPoint {
    x: number;
    y: number;
}

export class PoseOverlayRenderer {
    private readonly canvas: HTMLCanvasElement;
    private readonly videoElement: HTMLVideoElement;
    private readonly context: CanvasRenderingContext2D;

    private mirrored = true;

    constructor(
        canvas: HTMLCanvasElement,
        videoElement: HTMLVideoElement,
    ) {
        this.canvas = canvas;
        this.videoElement = videoElement;

        const context =
            canvas.getContext("2d");

        if (!context) {
            throw new Error(
                "Could not create the pose overlay canvas context.",
            );
        }

        this.context = context;
    }

    public setMirrored(mirrored: boolean): void {
        this.mirrored = mirrored;
    }

    public render(
        result: PoseLandmarkerResult,
    ): void {
        this.resize();

        this.context.clearRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height,
        );

        const landmarks =
            result.landmarks[0];

        if (!landmarks) {
            return;
        }

        this.drawConnections(landmarks);

        this.drawLandmarkGroup(
            landmarks,
            LEFT_FOOT_INDICES,
            "#5ee7ff",
        );

        this.drawLandmarkGroup(
            landmarks,
            RIGHT_FOOT_INDICES,
            "#ff76cf",
        );
    }

    public clear(): void {
        this.resize();

        this.context.clearRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height,
        );
    }

    private drawConnections(
        landmarks: PoseLandmarks,
    ): void {
        this.context.save();
        this.context.lineWidth = 4;
        this.context.strokeStyle =
            "rgba(255, 255, 255, 0.8)";

        for (
            const [startIndex, endIndex]
            of FOOT_CONNECTIONS
        ) {
            const start = landmarks[startIndex];
            const end = landmarks[endIndex];

            if (!start || !end) {
                continue;
            }

            const startPoint =
                this.toCanvasPoint(
                    start.x,
                    start.y,
                );

            const endPoint =
                this.toCanvasPoint(
                    end.x,
                    end.y,
                );

            this.context.beginPath();
            this.context.moveTo(
                startPoint.x,
                startPoint.y,
            );
            this.context.lineTo(
                endPoint.x,
                endPoint.y,
            );
            this.context.stroke();
        }

        this.context.restore();
    }

    private drawLandmarkGroup(
        landmarks: PoseLandmarks,
        indices: readonly number[],
        color: string,
    ): void {
        for (const index of indices) {
            const landmark = landmarks[index];

            if (!landmark) {
                continue;
            }

            const point = this.toCanvasPoint(
                landmark.x,
                landmark.y,
            );

            this.context.save();

            this.context.beginPath();
            this.context.arc(
                point.x,
                point.y,
                8,
                0,
                Math.PI * 2,
            );

            this.context.fillStyle = color;
            this.context.shadowColor = color;
            this.context.shadowBlur = 12;
            this.context.fill();

            this.context.restore();
        }
    }

    private toCanvasPoint(
        normalizedX: number,
        normalizedY: number,
    ): CanvasPoint {
        const videoWidth =
            this.videoElement.videoWidth;

        const videoHeight =
            this.videoElement.videoHeight;

        if (
            videoWidth === 0 ||
            videoHeight === 0
        ) {
            return {
                x: 0,
                y: 0,
            };
        }

        const destinationWidth =
            this.canvas.clientWidth;

        const destinationHeight =
            this.canvas.clientHeight;

        /*
         * The video uses object-fit: cover. Apply the same scaling and
         * cropping calculation so landmarks align with the preview.
         */
        const scale = Math.max(
            destinationWidth / videoWidth,
            destinationHeight / videoHeight,
        );

        const renderedWidth =
            videoWidth * scale;

        const renderedHeight =
            videoHeight * scale;

        const offsetX =
            (destinationWidth -
                renderedWidth) /
            2;

        const offsetY =
            (destinationHeight -
                renderedHeight) /
            2;

        const displayX = this.mirrored
            ? 1 - normalizedX
            : normalizedX;

        return {
            x:
                offsetX +
                displayX * renderedWidth,
            y:
                offsetY +
                normalizedY * renderedHeight,
        };
    }

    private resize(): void {
        const pixelRatio =
            window.devicePixelRatio || 1;

        const cssWidth =
            this.canvas.clientWidth;

        const cssHeight =
            this.canvas.clientHeight;

        const requiredWidth =
            Math.round(
                cssWidth * pixelRatio,
            );

        const requiredHeight =
            Math.round(
                cssHeight * pixelRatio,
            );

        if (
            this.canvas.width !==
            requiredWidth ||
            this.canvas.height !==
            requiredHeight
        ) {
            this.canvas.width =
                requiredWidth;

            this.canvas.height =
                requiredHeight;

            this.context.setTransform(
                pixelRatio,
                0,
                0,
                pixelRatio,
                0,
                0,
            );
        }
    }
}