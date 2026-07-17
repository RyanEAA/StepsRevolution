import type {
    PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

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

interface WeightedPosition {
    x: number;
    confidence: number;
    visible: boolean;
}

export class FootPositionEstimator {
    private visibilityThreshold = 0.5;
    private mirrored = true;

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

    public setMirrored(mirrored: boolean): void {
        this.mirrored = mirrored;
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
    ): WeightedPosition {
        let weightedXTotal = 0;
        let totalWeight = 0;
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

            const weight = Math.max(
                confidence,
                0.001,
            );

            weightedXTotal +=
                landmark.x * weight;

            totalWeight += weight;
            confidenceTotal += confidence;
            acceptedLandmarkCount += 1;
        }

        if (
            acceptedLandmarkCount === 0 ||
            totalWeight === 0
        ) {
            return {
                x: 0.5,
                confidence: 0,
                visible: false,
            };
        }

        return {
            x: this.clamp(
                weightedXTotal / totalWeight,
                0,
                1,
            ),
            confidence:
                confidenceTotal /
                acceptedLandmarkCount,
            visible: true,
        };
    }

    private toEstimatedFoot(
        position: WeightedPosition,
    ): EstimatedFoot {
        const displayX = this.mirrored
            ? 1 - position.x
            : position.x;

        return {
            sourceX: position.x,
            displayX: this.clamp(
                displayX,
                0,
                1,
            ),
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