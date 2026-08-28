import type {
    PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

import {
    CameraCoordinateMapper,
} from "./CameraCoordinateMapper";

const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;
const LEFT_HEEL = 29;
const RIGHT_HEEL = 30;
const LEFT_FOOT_INDEX = 31;
const RIGHT_FOOT_INDEX = 32;

const LEFT_FOOT_INDICES = [
    LEFT_ANKLE,
    LEFT_HEEL,
    LEFT_FOOT_INDEX,
] as const;

const RIGHT_FOOT_INDICES = [
    RIGHT_ANKLE,
    RIGHT_HEEL,
    RIGHT_FOOT_INDEX,
] as const;

type PoseLandmarks =
    PoseLandmarkerResult["landmarks"][number];

export interface EstimatedFoot {
    sourceX: number;
    displayX: number;
    confidence: number;
    visible: boolean;
}

export interface EstimatedFeet {
    left: EstimatedFoot;
    right: EstimatedFoot;
}

interface EstimatedPosition {
    sourceX: number;
    displayX: number;
    confidence: number;
    visible: boolean;
}


export class FootPositionEstimator {
    private visibilityThreshold = 0.5;
    private minimumFootConfidence = 0.5;
    private readonly coordinateMapper:
        CameraCoordinateMapper;

    constructor(
        coordinateMapper: CameraCoordinateMapper,
    ) {
        this.coordinateMapper = coordinateMapper;
    }

    public setVisibilityThreshold(
        threshold: number,
    ): void {
        this.visibilityThreshold = this.clamp(
            threshold,
            0,
            1,
        );
    }

    public getVisibilityThreshold(): number {
        return this.visibilityThreshold;
    }

    public setMinimumFootConfidence(
        threshold: number,
    ): void {
        this.minimumFootConfidence = this.clamp(
            threshold,
            0,
            1,
        );
    }

    public getMinimumFootConfidence(): number {
        return this.minimumFootConfidence;
    }

    public estimate(
        landmarks: PoseLandmarks | undefined,
    ): EstimatedFeet {
        if (!landmarks) {
            return {
                left: this.createInvisibleFoot(),
                right: this.createInvisibleFoot(),
            };
        }

        const left = this.estimatePosition(
            landmarks,
            LEFT_FOOT_INDICES,
        );

        const right = this.estimatePosition(
            landmarks,
            RIGHT_FOOT_INDICES,
        );

        return {
            left: this.toEstimatedFoot(left),
            right: this.toEstimatedFoot(right),
        };
    }

    private estimatePosition(
        landmarks: PoseLandmarks,
        indices: readonly number[],
    ): EstimatedPosition {
        let displayXTotal = 0;
        let sourceXTotal = 0;

        let confidenceTotal = 0;
        let acceptedLandmarkCount = 0;

        for (const index of indices) {
            const landmark = landmarks[index];

            if (!landmark) {
                continue;
            }

            const confidence =
                landmark.visibility ?? 1;

            if (
                confidence <
                this.visibilityThreshold
            ) {
                continue;
            }

            const displayX =
                this.coordinateMapper
                    .mapXToDisplay(
                        landmark.x,
                    );

            sourceXTotal += landmark.x;
            displayXTotal += displayX;

            confidenceTotal += confidence;
            acceptedLandmarkCount += 1;
        }

        if (acceptedLandmarkCount === 0) {
            return {
                sourceX: 0.5,
                displayX: 0.5,
                confidence: 0,
                visible: false,
            };
        }

        return {
            sourceX:
                sourceXTotal /
                acceptedLandmarkCount,

            displayX:
                displayXTotal /
                acceptedLandmarkCount,

            confidence:
                confidenceTotal /
                acceptedLandmarkCount,

            visible:
                confidenceTotal / acceptedLandmarkCount >=
                this.minimumFootConfidence,
        };
    }

    private toEstimatedFoot(
        position: EstimatedPosition,
    ): EstimatedFoot {
        return {
            sourceX: position.sourceX,
            displayX: position.displayX,
            confidence: position.confidence,
            visible: position.visible,
        };
    }

    private createInvisibleFoot(): EstimatedFoot {
        return {
            sourceX: 0.5,
            displayX: 0.5,
            confidence: 0,
            visible: false,
        };
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