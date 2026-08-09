export interface ClockSample {
    clientSentMs: number;
    serverReceivedMs: number;
    serverSentMs: number;
    clientReceivedMs: number;
}

export interface ClockEstimate {
    offsetMs: number;
    roundTripMs: number;
    sampledAtPerformanceMs: number;
    usable: boolean;
}

export class ClockSynchronizer {
    private estimate: ClockEstimate | null = null;

    public acceptSamples(samples: readonly ClockSample[]): ClockEstimate {
        if (samples.length === 0) throw new Error("At least one clock sample is required.");
        const calculated = samples.map((sample) => {
            const roundTripMs = (sample.clientReceivedMs - sample.clientSentMs) -
                (sample.serverSentMs - sample.serverReceivedMs);
            const offsetMs = ((sample.serverReceivedMs - sample.clientSentMs) +
                (sample.serverSentMs - sample.clientReceivedMs)) / 2;
            return { offsetMs, roundTripMs: Math.max(0, roundTripMs), sampledAtPerformanceMs: sample.clientReceivedMs };
        }).sort((left, right) => left.roundTripMs - right.roundTripMs);
        const best = calculated[0]!;
        this.estimate = { ...best, usable: best.roundTripMs <= 500 };
        return this.estimate;
    }

    public getEstimate(): ClockEstimate | null { return this.estimate; }

    public serverToPerformanceTime(serverTimeMs: number): number {
        if (!this.estimate?.usable) throw new Error("The multiplayer clock is not synchronized.");
        return serverTimeMs - this.estimate.offsetMs;
    }

    public isUsable(nowPerformanceMs = performance.now()): boolean {
        return Boolean(this.estimate?.usable && nowPerformanceMs - this.estimate.sampledAtPerformanceMs <= 30_000);
    }
}
