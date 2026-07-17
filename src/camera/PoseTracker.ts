import {
    FilesetResolver,
    PoseLandmarker,
    type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

const MEDIAPIPE_VERSION = "0.10.35";

const WASM_ROOT =
    "https://cdn.jsdelivr.net/npm/" +
    `@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

const POSE_MODEL_URL =
    "https://storage.googleapis.com/" +
    "mediapipe-models/pose_landmarker/" +
    "pose_landmarker_lite/float16/1/" +
    "pose_landmarker_lite.task";

export type PoseTrackerStatus =
    | "idle"
    | "loading"
    | "ready"
    | "error"
    | "destroyed";

export type PoseTrackerStatusListener = (
    status: PoseTrackerStatus,
    message: string,
) => void;

export class PoseTracker {
    private readonly videoElement: HTMLVideoElement;

    private readonly statusListeners =
        new Set<PoseTrackerStatusListener>();

    private poseLandmarker: PoseLandmarker | null =
        null;

    private initializationPromise:
        Promise<void> | null = null;

    private status: PoseTrackerStatus = "idle";

    private inferenceFramesPerSecond = 15;
    private lastInferenceTimeMs = -Infinity;
    private lastVideoTimeSeconds = -1;
    private lastMediaPipeTimestampMs = -1;

    private destroyed = false;

    constructor(videoElement: HTMLVideoElement) {
        this.videoElement = videoElement;
    }

    public subscribe(
        listener: PoseTrackerStatusListener,
    ): () => void {
        this.statusListeners.add(listener);

        return () => {
            this.statusListeners.delete(listener);
        };
    }

    public async initialize(): Promise<void> {
        if (this.poseLandmarker) {
            return;
        }

        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        if (this.destroyed) {
            throw new Error(
                "PoseTracker has already been destroyed.",
            );
        }

        this.initializationPromise =
            this.initializeInternal();

        try {
            await this.initializationPromise;
        } finally {
            this.initializationPromise = null;
        }
    }

    public detect(
        nowMs: number,
    ): PoseLandmarkerResult | null {
        if (
            !this.poseLandmarker ||
            this.destroyed
        ) {
            return null;
        }

        if (
            this.videoElement.readyState <
            HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
            return null;
        }

        const videoTimeSeconds =
            this.videoElement.currentTime;

        /*
         * requestAnimationFrame can run several times while the video
         * element still represents the same decoded frame.
         */
        if (
            videoTimeSeconds ===
            this.lastVideoTimeSeconds
        ) {
            return null;
        }

        const minimumIntervalMs =
            1000 /
            this.inferenceFramesPerSecond;

        if (
            nowMs - this.lastInferenceTimeMs <
            minimumIntervalMs
        ) {
            return null;
        }

        this.lastVideoTimeSeconds =
            videoTimeSeconds;

        this.lastInferenceTimeMs = nowMs;

        /*
         * MediaPipe requires timestamps to increase between adjacent
         * detectForVideo calls. performance.now() remains monotonic
         * even when a replaced camera stream resets video.currentTime.
         */
        const timestampMs = Math.max(
            Math.round(nowMs),
            this.lastMediaPipeTimestampMs + 1,
        );

        this.lastMediaPipeTimestampMs =
            timestampMs;

        return this.poseLandmarker.detectForVideo(
            this.videoElement,
            timestampMs,
        );
    }

    public setInferenceFramesPerSecond(
        framesPerSecond: number,
    ): void {
        this.inferenceFramesPerSecond =
            this.clamp(
                framesPerSecond,
                1,
                30,
            );
    }

    public getInferenceFramesPerSecond(): number {
        return this.inferenceFramesPerSecond;
    }

    public resetVideoState(): void {
        this.lastInferenceTimeMs = -Infinity;
        this.lastVideoTimeSeconds = -1;
    }

    public isReady(): boolean {
        return this.poseLandmarker !== null;
    }

    public getStatus(): PoseTrackerStatus {
        return this.status;
    }

    public destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;

        this.poseLandmarker?.close();
        this.poseLandmarker = null;

        this.statusListeners.clear();
        this.status = "destroyed";
    }

    private async initializeInternal(): Promise<void> {
        this.setStatus(
            "loading",
            "Loading MediaPipe pose model...",
        );

        try {
            const vision =
                await FilesetResolver.forVisionTasks(
                    WASM_ROOT,
                );

            if (this.destroyed) {
                return;
            }

            this.poseLandmarker =
                await PoseLandmarker.createFromOptions(
                    vision,
                    {
                        baseOptions: {
                            modelAssetPath:
                                POSE_MODEL_URL,
                        },
                        runningMode: "VIDEO",
                        numPoses: 1,
                        minPoseDetectionConfidence:
                            0.5,
                        minPosePresenceConfidence:
                            0.5,
                        minTrackingConfidence:
                            0.5,
                        outputSegmentationMasks:
                            false,
                    },
                );

            if (this.destroyed) {
                this.poseLandmarker.close();
                this.poseLandmarker = null;
                return;
            }

            this.setStatus(
                "ready",
                "Pose tracking is ready.",
            );
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unknown MediaPipe initialization error.";

            this.setStatus(
                "error",
                `Could not load pose tracking: ${message}`,
            );

            throw error;
        }
    }

    private setStatus(
        status: PoseTrackerStatus,
        message: string,
    ): void {
        this.status = status;

        for (const listener of this.statusListeners) {
            listener(status, message);
        }
    }

    private clamp(
        value: number,
        minimum: number,
        maximum: number,
    ): number {
        return Math.min(
            Math.max(value, minimum),
            maximum,
        );
    }
}