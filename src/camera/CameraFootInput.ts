import type {
    InputSource,
} from "../input/InputSource";

import type {
    FootState,
} from "../types/FootState";

import {
    CameraManager,
} from "./CameraManager";

import {
    FootPositionEstimator,
    type EstimatedFeet,
} from "./FootPositionEstimator";

import {
    PoseOverlayRenderer,
} from "./PoseOverlayRenderer";

import {
    PoseTracker,
    type PoseTrackerStatusListener,
} from "./PoseTracker";

import {
    CameraCoordinateMapper,
} from "./CameraCoordinatorMapper";

export interface CameraFootDebugState {
    leftSourceX: number;
    rightSourceX: number;

    leftDisplayX: number;
    rightDisplayX: number;

    leftConfidence: number;
    rightConfidence: number;

    leftVisible: boolean;
    rightVisible: boolean;
}

export class CameraFootInput implements InputSource {
    private readonly cameraManager: CameraManager;
    private readonly poseTracker: PoseTracker;

    private readonly overlayRenderer:
        PoseOverlayRenderer;

    private readonly coordinateMapper:
        CameraCoordinateMapper;

    private readonly estimator:
        FootPositionEstimator;

    private footState: FootState = {
        leftX: 0.375,
        rightX: 0.625,
        leftVisible: false,
        rightVisible: false,
        timestampMs: performance.now(),
    };

    private debugState: CameraFootDebugState = {
        leftSourceX: 0.5,
        rightSourceX: 0.5,
        leftDisplayX: 0.5,
        rightDisplayX: 0.5,
        leftConfidence: 0,
        rightConfidence: 0,
        leftVisible: false,
        rightVisible: false,
    };

    constructor(
        cameraManager: CameraManager,
        poseOverlayCanvas: HTMLCanvasElement,
    ) {
        this.cameraManager = cameraManager;

        const videoElement =
            cameraManager.getVideoElement();

        const previewShell =
            videoElement.closest<HTMLElement>(
                ".camera-preview-shell",
            );

        if (!previewShell) {
            throw new Error(
                "Camera preview shell was not found.",
            );
        }

        this.coordinateMapper =
            new CameraCoordinateMapper(
                videoElement,
                previewShell,
            );

        this.estimator =
            new FootPositionEstimator(
                this.coordinateMapper,
            );

        this.poseTracker =
            new PoseTracker(videoElement);

        this.overlayRenderer =
            new PoseOverlayRenderer(
                poseOverlayCanvas,
                videoElement,
            );
    }

    public async initialize(): Promise<void> {
        await this.poseTracker.initialize();
    }

    public update(
        _deltaSeconds: number,
    ): void {
        const nowMs = performance.now();

        if (!this.cameraManager.isRunning()) {
            this.setInvisible(nowMs);
            this.overlayRenderer.clear();
            this.poseTracker.resetVideoState();
            return;
        }

        if (!this.poseTracker.isReady()) {
            this.setInvisible(nowMs);
            return;
        }

        try {
            const result =
                this.poseTracker.detect(nowMs);

            if (!result) {
                /*
                 * No inference was performed this animation frame.
                 * Keep the most recent inference result.
                 */
                return;
            }

            const landmarks =
                result.landmarks[0];

            if (!landmarks) {
                /*
                 * Inference ran successfully, but MediaPipe did not
                 * detect a pose.
                 */
                this.setInvisible(nowMs);
                this.overlayRenderer.clear();
                return;
            }

            this.overlayRenderer.render(result);

            const feet =
                this.estimator.estimate(
                    landmarks,
                );

            this.applyEstimate(
                feet,
                nowMs,
            );
        } catch (error) {
            console.error(
                "Pose inference failed:",
                error,
            );

            this.setInvisible(nowMs);
            this.overlayRenderer.clear();
        }
    }

    public getFootState(): FootState {
        return this.footState;
    }

    public getDebugState():
        Readonly<CameraFootDebugState> {
        return this.debugState;
    }

    public setMirrored(
        mirrored: boolean,
    ): void {
        this.coordinateMapper.setMirrored(
            mirrored,
        );
        this.overlayRenderer.setMirrored(
            mirrored,
        );
    }

    public setVisibilityThreshold(
        threshold: number,
    ): void {
        this.estimator.setVisibilityThreshold(
            threshold,
        );
    }

    public setInferenceFramesPerSecond(
        framesPerSecond: number,
    ): void {
        this.poseTracker
            .setInferenceFramesPerSecond(
                framesPerSecond,
            );
    }

    public subscribeToTrackerStatus(
        listener: PoseTrackerStatusListener,
    ): () => void {
        return this.poseTracker.subscribe(
            listener,
        );
    }

    public destroy(): void {
        this.poseTracker.destroy();
        this.overlayRenderer.clear();
        this.cameraManager.destroy();
    }

    private applyEstimate(
        feet: EstimatedFeet,
        timestampMs: number,
    ): void {
        this.footState = {
            leftX: feet.left.displayX,
            rightX: feet.right.displayX,
            leftVisible: feet.left.visible,
            rightVisible: feet.right.visible,
            timestampMs,
        };

        this.debugState = {
            leftSourceX:
                feet.left.sourceX,

            rightSourceX:
                feet.right.sourceX,

            leftDisplayX:
                feet.left.displayX,

            rightDisplayX:
                feet.right.displayX,

            leftConfidence:
                feet.left.confidence,

            rightConfidence:
                feet.right.confidence,

            leftVisible:
                feet.left.visible,

            rightVisible:
                feet.right.visible,
        };
    }

    private setInvisible(
        timestampMs: number,
    ): void {
        this.footState = {
            ...this.footState,
            leftVisible: false,
            rightVisible: false,
            timestampMs,
        };

        this.debugState = {
            ...this.debugState,
            leftConfidence: 0,
            rightConfidence: 0,
            leftVisible: false,
            rightVisible: false,
        };
    }
}