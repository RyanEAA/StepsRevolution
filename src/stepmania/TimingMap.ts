import type { BpmSegment } from "../types/Chart";

export class TimingMap {
    private readonly segments: readonly BpmSegment[];
    private readonly offsetSeconds: number;

    public constructor(
        bpmSegments: readonly BpmSegment[],
        offsetSeconds: number,
    ) {
        if (bpmSegments.length === 0) {
            throw new Error(
                "Cannot create a timing map without BPM segments.",
            );
        }

        this.segments = [...bpmSegments].sort(
            (left, right) => left.beat - right.beat,
        );

        this.offsetSeconds = offsetSeconds;

        this.validateSegments();
    }

    public beatToSeconds(beat: number): number {
        if (!Number.isFinite(beat)) {
            throw new Error(
                `Cannot convert invalid beat "${beat}".`,
            );
        }

        if (beat < 0) {
            return (
                beat *
                    this.secondsPerBeat(
                        this.segments[0]!.bpm,
                    ) -
                this.offsetSeconds
            );
        }

        let elapsedSeconds = 0;

        for (
            let index = 0;
            index < this.segments.length;
            index += 1
        ) {
            const currentSegment = this.segments[index];

            if (!currentSegment) {
                continue;
            }

            const nextSegment =
                this.segments[index + 1];

            const startBeat = currentSegment.beat;

            if (beat <= startBeat) {
                break;
            }

            const endBeat = nextSegment
                ? Math.min(beat, nextSegment.beat)
                : beat;

            const beatsInSegment =
                endBeat - startBeat;

            if (beatsInSegment > 0) {
                elapsedSeconds +=
                    beatsInSegment *
                    this.secondsPerBeat(
                        currentSegment.bpm,
                    );
            }

            if (
                !nextSegment ||
                beat < nextSegment.beat
            ) {
                break;
            }
        }

        /*
         * StepMania convention:
         *
         * A negative offset means beat zero occurs after the beginning
         * of the audio file.
         *
         * Example:
         * OFFSET = -0.053
         * Beat zero occurs at audio time 0.053 seconds.
         */
        return elapsedSeconds - this.offsetSeconds;
    }

    public getBpmAtBeat(beat: number): number {
        let bpm = this.segments[0]!.bpm;

        for (const segment of this.segments) {
            if (segment.beat > beat) {
                break;
            }

            bpm = segment.bpm;
        }

        return bpm;
    }

    private validateSegments(): void {
        const firstSegment = this.segments[0];

        if (!firstSegment) {
            throw new Error(
                "Timing map has no first BPM segment.",
            );
        }

        if (firstSegment.beat !== 0) {
            throw new Error(
                "The first supported BPM segment must begin at beat 0.",
            );
        }

        for (const segment of this.segments) {
            if (
                !Number.isFinite(segment.beat) ||
                !Number.isFinite(segment.bpm) ||
                segment.bpm <= 0
            ) {
                throw new Error(
                    `Invalid BPM segment at beat ${segment.beat}.`,
                );
            }
        }
    }

    private secondsPerBeat(bpm: number): number {
        return 60 / bpm;
    }
}