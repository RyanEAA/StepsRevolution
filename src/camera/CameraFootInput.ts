import type {
    InputSource,
} from "../input/InputSource";

import type {
    FootState,
} from "../types/FootState";

import {
    CameraManager,
    type CameraStatus,
} from "./CameraManager";

import {
    CameraFrameScheduler,
    type CameraFrameSchedulerMode,
} from "./CameraFrameScheduler";

import {
    FootPositionEstimator,
    type EstimatedFeet,
} from "./FootPositionEstimator";

import {
    FootIdentityTracker,
} from "./FootIdentityTracker";

import {
    PoseOverlayRenderer,
} from "./PoseOverlayRenderer";

import {
    PoseTracker,
    type PoseTrackerStatusListener,
} from "./PoseTracker";

import {
    CameraCoordinateMapper,
} from "./CameraCoordinateMapper";

export interface CameraFootDebugState {
    leftSourceX: number;
    rightSourceX: number;

    leftDisplayX: number;
    rightDisplayX: number;

    leftConfidence: number;
    rightConfidence: number;

    leftVisible: boolean;
    rightVisible: boolean;

    identityCorrectionActive: boolean;
    leftOcclusionHold: boolean;
    rightOcclusionHold: boolean;

    schedulerMode: CameraFrameSchedulerMode;
    inferenceDurationMs: number;
    inferenceFramesPerSecond: number;
}

export class CameraFootInput implements InputSource {
    private readonly cameraManager: CameraManager;
    private readonly poseTracker: PoseTracker;
    private readonly frameScheduler:
        CameraFrameScheduler;

    private readonly overlayRenderer:
        PoseOverlayRenderer;

    private readonly coordinateMapper:
        CameraCoordinateMapper;

    private readonly estimator:
        FootPositionEstimator;

    private readonly identityTracker =
        new FootIdentityTracker();

    private unsubscribeFromCameraStatus:
        (() => void) | null = null;

    private active = false;
    private destroyed = false;
    private mirrored = true;
    private previousInferenceTimeMs = -Infinity;
    private smoothedInferenceFramesPerSecond = 0;

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
        identityCorrectionActive: false,
        leftOcclusionHold: false,
        rightOcclusionHold: false,
        schedulerMode: "animation-frame",
        inferenceDurationMs: 0,
        inferenceFramesPerSecond: 0,
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

        this.frameScheduler =
            new CameraFrameScheduler(videoElement);

        this.debugState = {
            ...this.debugState,
            schedulerMode:
                this.frameScheduler.getMode(),
        };

        this.overlayRenderer =
            new PoseOverlayRenderer(
                poseOverlayCanvas,
                this.coordinateMapper,
            );

        this.unsubscribeFromCameraStatus =
            this.cameraManager.subscribe(
                this.handleCameraStatus,
            );
    }

    public async initialize(): Promise<void> {
        await this.poseTracker.initialize();
        this.updateScheduling();
    }

    public update(
        _deltaSeconds: number,
    ): void {
        /*
         * Camera inference is driven by CameraFrameScheduler. The game loop
         * calls update() only to satisfy the shared InputSource contract.
         */
    }

    public setActive(active: boolean): void {
        if (this.destroyed || this.active === active) {
            return;
        }

        this.active = active;
        this.updateScheduling();
    }

    private readonly processVideoFrame = (
        nowMs: number,
    ): void => {
        if (
            !this.active ||
            !this.cameraManager.isRunning()
        ) {
            return;
        }

        if (!this.poseTracker.isReady()) {
            this.setInvisible(nowMs);
            return;
        }

        try {
            const inferenceStartTimeMs =
                performance.now();

            const result =
                this.poseTracker.detect(nowMs);

            if (!result) {
                /*
                 * This decoded frame was skipped by the configured inference
                 * throttle. Keep the most recent inference result.
                 */
                return;
            }

            this.recordInferencePerformance(
                nowMs,
                performance.now() - inferenceStartTimeMs,
            );

            this.coordinateMapper
                .refreshDisplayGeometry();

            const landmarks =
                result.landmarks[0];

            if (!landmarks) {
                /*
                 * Inference ran successfully, but MediaPipe did not
                 * detect a pose. Feed an empty estimate through the
                 * temporal tracker so brief occlusions do not cause
                 * immediate input dropouts.
                 */
                this.applyEstimate(
                    this.estimator.estimate(undefined),
                    nowMs,
                );
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
    };

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
        if (this.mirrored === mirrored) {
            return;
        }

        this.mirrored = mirrored;
        this.coordinateMapper.setMirrored(
            mirrored,
        );
        this.identityTracker.reset();
    }

    public setVisibilityThreshold(
        threshold: number,
    ): void {
        this.estimator.setVisibilityThreshold(
            threshold,
        );
    }

    public setMinimumFootConfidence(
        threshold: number,
    ): void {
        this.estimator.setMinimumFootConfidence(
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
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.frameScheduler.stop();
        this.unsubscribeFromCameraStatus?.();
        this.unsubscribeFromCameraStatus = null;
        this.poseTracker.destroy();
        this.overlayRenderer.clear();
        this.cameraManager.destroy();
    }

    private applyEstimate(
        rawFeet: EstimatedFeet,
        timestampMs: number,
    ): void {
        const tracking =
            this.identityTracker.update(
                rawFeet,
                timestampMs,
            );

        const feet = tracking.feet;

        this.footState = {
            leftX: feet.left.displayX,
            rightX: feet.right.displayX,
            leftVisible: feet.left.visible,
            rightVisible: feet.right.visible,
            timestampMs,
        };

        this.debugState = {
            ...this.debugState,
            // Raw values preserve MediaPipe's labels so diagnostics can
            // reveal when temporal identity correction is taking over.
            leftSourceX:
                rawFeet.left.sourceX,

            rightSourceX:
                rawFeet.right.sourceX,

            // Game X values are the stabilized, identity-tracked output.
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

            identityCorrectionActive:
                tracking.correctedSwap,

            leftOcclusionHold:
                tracking.leftHeldThroughOcclusion,

            rightOcclusionHold:
                tracking.rightHeldThroughOcclusion,
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
            identityCorrectionActive: false,
            leftOcclusionHold: false,
            rightOcclusionHold: false,
        };
    }

    private readonly handleCameraStatus = (
        status: CameraStatus,
    ): void => {
        if (status === "running") {
            this.poseTracker.resetVideoState();
            this.identityTracker.reset();
            this.resetInferencePerformance();
            this.updateScheduling();
            return;
        }

        if (
            status === "stopped" ||
            status === "error"
        ) {
            this.frameScheduler.stop();
            this.poseTracker.resetVideoState();
            this.identityTracker.reset();
            this.resetInferencePerformance();
            this.setInvisible(performance.now());
            this.overlayRenderer.clear();
        }
    };

    private updateScheduling(): void {
        if (
            this.destroyed ||
            !this.active ||
            !this.cameraManager.isRunning() ||
            !this.poseTracker.isReady()
        ) {
            this.frameScheduler.stop();
            return;
        }

        this.frameScheduler.start(
            this.processVideoFrame,
        );
    }

    private recordInferencePerformance(
        nowMs: number,
        durationMs: number,
    ): void {
        if (
            Number.isFinite(
                this.previousInferenceTimeMs,
            )
        ) {
            const intervalMs =
                nowMs - this.previousInferenceTimeMs;

            if (intervalMs > 0) {
                const currentFramesPerSecond =
                    1000 / intervalMs;

                this.smoothedInferenceFramesPerSecond =
                    this.smoothedInferenceFramesPerSecond === 0
                        ? currentFramesPerSecond
                        : this.smoothedInferenceFramesPerSecond * 0.85 +
                            currentFramesPerSecond * 0.15;
            }
        }

        this.previousInferenceTimeMs = nowMs;

        this.debugState = {
            ...this.debugState,
            inferenceDurationMs: durationMs,
            inferenceFramesPerSecond:
                this.smoothedInferenceFramesPerSecond,
        };
    }

    private resetInferencePerformance(): void {
        this.previousInferenceTimeMs = -Infinity;
        this.smoothedInferenceFramesPerSecond = 0;

        this.debugState = {
            ...this.debugState,
            inferenceDurationMs: 0,
            inferenceFramesPerSecond: 0,
        };
    }
}
