import type { Lane } from "./Note";

export interface BpmSegment {
    beat: number;
    bpm: number;
}

export interface ParsedChartNote {
    lane: Lane;
    beat: number;
}

export interface StepManiaChart {
    stepType: string;
    description: string;
    difficulty: string;
    meter: number;
    radarValues: number[];

    notes: ParsedChartNote[];
}

export interface StepManiaSimfile {
    title: string;
    subtitle: string;
    artist: string;

    musicFilename: string;
    bannerFilename: string;
    backgroundFilename: string;

    offsetSeconds: number;
    sampleStartSeconds: number;
    sampleLengthSeconds: number;

    bpmSegments: BpmSegment[];
    charts: StepManiaChart[];
}

export interface RuntimeChartNote {
    lane: Lane;
    beat: number;
    hitTimeSeconds: number;
}