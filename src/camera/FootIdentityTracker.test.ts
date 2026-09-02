import { describe, expect, it } from "vitest";

import {
    FootIdentityTracker,
} from "./FootIdentityTracker";

import type {
    EstimatedFeet,
    EstimatedFoot,
} from "./FootPositionEstimator";

function foot(
    x: number,
    confidence = 0.9,
    visible = true,
): EstimatedFoot {
    return {
        sourceX: x,
        displayX: x,
        confidence,
        visible,
    };
}

function feet(
    leftX: number,
    rightX: number,
): EstimatedFeet {
    return {
        left: foot(leftX),
        right: foot(rightX),
    };
}

describe("FootIdentityTracker", () => {
    it("preserves normal left/right assignments", () => {
        const tracker = new FootIdentityTracker();

        tracker.update(feet(0.25, 0.75), 0);
        const result = tracker.update(
            feet(0.27, 0.73),
            66,
        );

        expect(result.correctedSwap).toBe(false);
        expect(result.feet.left.displayX).toBeLessThan(
            result.feet.right.displayX,
        );
    });

    it("corrects an obvious one-frame MediaPipe label swap", () => {
        const tracker = new FootIdentityTracker();

        tracker.update(feet(0.24, 0.76), 0);
        tracker.update(feet(0.26, 0.74), 66);

        const result = tracker.update(
            feet(0.73, 0.27),
            132,
        );

        expect(result.correctedSwap).toBe(true);
        expect(result.feet.left.displayX).toBeLessThan(
            0.4,
        );
        expect(result.feet.right.displayX).toBeGreaterThan(
            0.6,
        );
    });

    it("briefly holds a reliable foot through an occlusion", () => {
        const tracker = new FootIdentityTracker();

        tracker.update(feet(0.3, 0.7), 0);

        const missing: EstimatedFeet = {
            left: foot(0.5, 0, false),
            right: foot(0.5, 0, false),
        };

        const held = tracker.update(missing, 120);
        const expired = tracker.update(missing, 300);

        expect(held.feet.left.visible).toBe(true);
        expect(held.feet.right.visible).toBe(true);
        expect(held.leftHeldThroughOcclusion).toBe(true);
        expect(held.rightHeldThroughOcclusion).toBe(true);

        expect(expired.feet.left.visible).toBe(false);
        expect(expired.feet.right.visible).toBe(false);
    });
});
