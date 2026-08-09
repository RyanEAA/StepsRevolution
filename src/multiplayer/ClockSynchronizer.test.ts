import { describe, expect, it } from "vitest";
import { ClockSynchronizer } from "./ClockSynchronizer";

describe("ClockSynchronizer", () => {
    it("uses the lowest-latency sample and translates server timestamps", () => {
        const clock = new ClockSynchronizer();
        const estimate = clock.acceptSamples([
            { clientSentMs: 100, serverReceivedMs: 1_100, serverSentMs: 1_102, clientReceivedMs: 142 },
            { clientSentMs: 200, serverReceivedMs: 1_210, serverSentMs: 1_212, clientReceivedMs: 222 },
        ]);
        expect(estimate.roundTripMs).toBe(20);
        expect(estimate.offsetMs).toBe(1_000);
        expect(clock.serverToPerformanceTime(2_500)).toBe(1_500);
    });

    it("rejects high latency and stale estimates", () => {
        const clock = new ClockSynchronizer();
        const estimate = clock.acceptSamples([
            { clientSentMs: 0, serverReceivedMs: 1_000, serverSentMs: 1_000, clientReceivedMs: 700 },
        ]);
        expect(estimate.usable).toBe(false);
        expect(clock.isUsable(40_000)).toBe(false);
    });
});
