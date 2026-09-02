import type {
    EstimatedFeet,
    EstimatedFoot,
} from "./FootPositionEstimator";

export interface FootIdentityTrackingResult {
    feet: EstimatedFeet;
    correctedSwap: boolean;
    leftHeldThroughOcclusion: boolean;
    rightHeldThroughOcclusion: boolean;
}

interface FootTrack {
    initialized: boolean;
    sourceX: number;
    displayX: number;
    velocityXPerMs: number;
    confidence: number;
    visible: boolean;
    lastMeasurementTimeMs: number;
    lastReliableTimeMs: number;
    lastOutputTimeMs: number;
}

interface Assignment {
    left: EstimatedFoot | null;
    right: EstimatedFoot | null;
    correctedSwap: boolean;
}

const OCCLUSION_GRACE_MS = 220;
const TRACK_RESET_AFTER_MS = 700;
const MAX_PREDICTION_MS = 120;
const MAX_VELOCITY_PER_MS = 0.005;
const ENTER_SWAP_MARGIN = 0.04;
const EXIT_SWAP_MARGIN = 0.025;
const LABEL_PREFERENCE_PENALTY = 0.035;
const INVISIBLE_CANDIDATE_PENALTY = 0.055;
const MISSING_CANDIDATE_PENALTY = 0.34;
const CONFIDENCE_PENALTY_WEIGHT = 0.035;
const VELOCITY_SMOOTHING = 0.35;

/**
 * Maintains stable physical left/right foot identities across pose frames.
 *
 * MediaPipe's anatomical LEFT/RIGHT labels are useful evidence, but a single
 * frame can occasionally flip those labels during occlusion or leg crossing.
 * This tracker compares both possible assignments against recent position and
 * velocity history, then applies light hysteresis before overriding the labels.
 */
export class FootIdentityTracker {
    private leftTrack = this.createTrack();
    private rightTrack = this.createTrack();
    private usingSwappedAssignment = false;

    public update(
        rawFeet: EstimatedFeet,
        timestampMs: number,
    ): FootIdentityTrackingResult {
        const assignment = this.chooseAssignment(
            rawFeet,
            timestampMs,
        );

        const leftUpdate = this.updateTrack(
            this.leftTrack,
            assignment.left,
            timestampMs,
        );

        const rightUpdate = this.updateTrack(
            this.rightTrack,
            assignment.right,
            timestampMs,
        );

        return {
            feet: {
                left: leftUpdate.foot,
                right: rightUpdate.foot,
            },
            correctedSwap: assignment.correctedSwap,
            leftHeldThroughOcclusion: leftUpdate.heldThroughOcclusion,
            rightHeldThroughOcclusion: rightUpdate.heldThroughOcclusion,
        };
    }

    public reset(): void {
        this.leftTrack = this.createTrack();
        this.rightTrack = this.createTrack();
        this.usingSwappedAssignment = false;
    }

    private chooseAssignment(
        rawFeet: EstimatedFeet,
        timestampMs: number,
    ): Assignment {
        const rawLeft = this.isUsableCandidate(rawFeet.left)
            ? rawFeet.left
            : null;

        const rawRight = this.isUsableCandidate(rawFeet.right)
            ? rawFeet.right
            : null;

        if (!rawLeft && !rawRight) {
            return {
                left: null,
                right: null,
                correctedSwap: this.usingSwappedAssignment,
            };
        }

        const normalScore =
            this.scoreCandidate(
                this.leftTrack,
                rawLeft,
                timestampMs,
                false,
            ) +
            this.scoreCandidate(
                this.rightTrack,
                rawRight,
                timestampMs,
                false,
            );

        const swappedScore =
            this.scoreCandidate(
                this.leftTrack,
                rawRight,
                timestampMs,
                true,
            ) +
            this.scoreCandidate(
                this.rightTrack,
                rawLeft,
                timestampMs,
                true,
            );

        if (this.usingSwappedAssignment) {
            if (
                normalScore + EXIT_SWAP_MARGIN <
                swappedScore
            ) {
                this.usingSwappedAssignment = false;
            }
        } else if (
            swappedScore + ENTER_SWAP_MARGIN <
            normalScore
        ) {
            this.usingSwappedAssignment = true;
        }

        if (this.usingSwappedAssignment) {
            return {
                left: rawRight,
                right: rawLeft,
                correctedSwap: true,
            };
        }

        return {
            left: rawLeft,
            right: rawRight,
            correctedSwap: false,
        };
    }

    private scoreCandidate(
        track: FootTrack,
        candidate: EstimatedFoot | null,
        timestampMs: number,
        labelWasSwapped: boolean,
    ): number {
        if (!candidate) {
            return MISSING_CANDIDATE_PENALTY;
        }

        let score =
            (1 - candidate.confidence) *
            CONFIDENCE_PENALTY_WEIGHT;

        if (!candidate.visible) {
            score += INVISIBLE_CANDIDATE_PENALTY;
        }

        if (labelWasSwapped) {
            score += LABEL_PREFERENCE_PENALTY;
        }

        if (
            !track.initialized ||
            timestampMs - track.lastMeasurementTimeMs >
                TRACK_RESET_AFTER_MS
        ) {
            return score;
        }

        const elapsedMs = this.clamp(
            timestampMs - track.lastMeasurementTimeMs,
            0,
            MAX_PREDICTION_MS,
        );

        const predictedX = this.clamp(
            track.displayX +
                track.velocityXPerMs * elapsedMs,
            0,
            1,
        );

        score += Math.abs(
            candidate.displayX - predictedX,
        );

        return score;
    }

    private updateTrack(
        track: FootTrack,
        candidate: EstimatedFoot | null,
        timestampMs: number,
    ): {
        foot: EstimatedFoot;
        heldThroughOcclusion: boolean;
    } {
        const previousReliableTimeMs =
            track.lastReliableTimeMs;

        if (candidate) {
            const measurementGapMs = track.initialized
                ? Math.max(
                      1,
                      timestampMs -
                          track.lastMeasurementTimeMs,
                  )
                : 0;

            const shouldReacquire =
                !track.initialized ||
                measurementGapMs >
                    TRACK_RESET_AFTER_MS;

            if (shouldReacquire) {
                track.sourceX = candidate.sourceX;
                track.displayX = candidate.displayX;
                track.velocityXPerMs = 0;
                track.initialized = true;
            } else {
                const measuredVelocity = this.clamp(
                    (candidate.displayX -
                        track.displayX) /
                        measurementGapMs,
                    -MAX_VELOCITY_PER_MS,
                    MAX_VELOCITY_PER_MS,
                );

                track.velocityXPerMs =
                    track.velocityXPerMs *
                        (1 - VELOCITY_SMOOTHING) +
                    measuredVelocity *
                        VELOCITY_SMOOTHING;

                const alpha = this.smoothingAlpha(
                    candidate.confidence,
                );

                track.displayX = this.lerp(
                    track.displayX,
                    candidate.displayX,
                    alpha,
                );

                track.sourceX = this.lerp(
                    track.sourceX,
                    candidate.sourceX,
                    alpha,
                );
            }

            track.confidence = candidate.confidence;
            track.lastMeasurementTimeMs = timestampMs;
            track.lastOutputTimeMs = timestampMs;

            if (candidate.visible) {
                track.lastReliableTimeMs = timestampMs;
            }

            const heldThroughOcclusion =
                !candidate.visible &&
                track.visible &&
                timestampMs - previousReliableTimeMs <=
                    OCCLUSION_GRACE_MS;

            track.visible =
                candidate.visible ||
                heldThroughOcclusion;

            return {
                foot: this.toFoot(track),
                heldThroughOcclusion,
            };
        }

        if (!track.initialized) {
            return {
                foot: this.invisibleFoot(),
                heldThroughOcclusion: false,
            };
        }

        const sinceReliableMs =
            timestampMs - track.lastReliableTimeMs;

        const heldThroughOcclusion =
            track.visible &&
            sinceReliableMs <= OCCLUSION_GRACE_MS;

        const elapsedOutputMs = this.clamp(
            timestampMs - track.lastOutputTimeMs,
            0,
            MAX_PREDICTION_MS,
        );

        if (heldThroughOcclusion) {
            track.displayX = this.clamp(
                track.displayX +
                    track.velocityXPerMs *
                        elapsedOutputMs,
                0,
                1,
            );

            const remainingFraction = this.clamp(
                1 -
                    sinceReliableMs /
                        OCCLUSION_GRACE_MS,
                0,
                1,
            );

            track.confidence *= remainingFraction;
        } else {
            track.visible = false;
            track.confidence = 0;
            track.velocityXPerMs *= 0.5;
        }

        track.lastOutputTimeMs = timestampMs;

        return {
            foot: this.toFoot(track),
            heldThroughOcclusion,
        };
    }

    private smoothingAlpha(confidence: number): number {
        return this.clamp(
            0.32 + confidence * 0.46,
            0.32,
            0.78,
        );
    }

    private isUsableCandidate(
        foot: EstimatedFoot,
    ): boolean {
        return (
            Number.isFinite(foot.sourceX) &&
            Number.isFinite(foot.displayX) &&
            Number.isFinite(foot.confidence) &&
            foot.confidence > 0
        );
    }

    private toFoot(track: FootTrack): EstimatedFoot {
        return {
            sourceX: this.clamp(track.sourceX, 0, 1),
            displayX: this.clamp(track.displayX, 0, 1),
            confidence: this.clamp(
                track.confidence,
                0,
                1,
            ),
            visible: track.visible,
        };
    }

    private invisibleFoot(): EstimatedFoot {
        return {
            sourceX: 0.5,
            displayX: 0.5,
            confidence: 0,
            visible: false,
        };
    }

    private createTrack(): FootTrack {
        return {
            initialized: false,
            sourceX: 0.5,
            displayX: 0.5,
            velocityXPerMs: 0,
            confidence: 0,
            visible: false,
            lastMeasurementTimeMs: -Infinity,
            lastReliableTimeMs: -Infinity,
            lastOutputTimeMs: -Infinity,
        };
    }

    private lerp(
        from: number,
        to: number,
        alpha: number,
    ): number {
        return from + (to - from) * alpha;
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
