import { describe, expect, it } from "vitest";

import {
    ASSET_PROTOCOL_VERSION,
    RELAY_ASSET_LIMITS,
    playerAssetPreparationSchema,
    relayCommandSchema,
    roomSongPackageSchema,
    runtimeSongPackagePayloadSchema,
} from "./relaySchemas";
import {
    CHART_IDENTITY_VERSION,
    PROTOCOL_VERSION,
} from "./constants";

const hash = (character: string) =>
    `sha256:${character.repeat(64)}`;
const chartHash = (character: string) =>
    `${CHART_IDENTITY_VERSION}:${character.repeat(64)}`;
const asset = (
    kind: "song-audio" | "chart-package",
    character: string,
) => ({
    assetId: `${kind.replace("-", "_")}_asset_123456`,
    kind,
    mimeType: kind === "song-audio"
        ? "audio/ogg"
        : "application/json",
    byteLength: 1_024,
    sha256: hash(character),
    expiresAtServerMs: 50_000,
});

const chart = {
    chartId: "chart-hard",
    chartHash: chartHash("c"),
    stepType: "dance-single" as const,
    description: "",
    difficulty: "Hard",
    meter: 9,
    tapCount: 100,
    durationSeconds: 90,
};

const songPackage = {
    assetProtocolVersion: ASSET_PROTOCOL_VERSION,
    selectionRevision: 3,
    packageId: "package-123456789",
    songId: "song-1",
    title: "Test Song",
    subtitle: "",
    artist: "Test Artist",
    artwork: null,
    audio: asset("song-audio", "a"),
    chartPackage: asset("chart-package", "b"),
    charts: [chart],
    selectedByPlayerId: "host-1",
    selectedAtServerMs: 10_000,
};

describe("relay asset protocol", () => {
    it("accepts a song package with independently selectable charts", () => {
        expect(roomSongPackageSchema.parse(songPackage).charts[0])
            .toMatchObject({ chartId: "chart-hard", difficulty: "Hard" });
    });

    it("rejects oversized audio and duplicate chart identities", () => {
        expect(roomSongPackageSchema.safeParse({
            ...songPackage,
            audio: {
                ...songPackage.audio,
                byteLength: RELAY_ASSET_LIMITS.songAudioBytes + 1,
            },
        }).success).toBe(false);

        expect(roomSongPackageSchema.safeParse({
            ...songPackage,
            charts: [chart, { ...chart, difficulty: "Challenge" }],
        }).success).toBe(false);
    });

    it("requires a verified audio hash before preparation is complete", () => {
        expect(playerAssetPreparationSchema.safeParse({
            selectionRevision: 3,
            status: "prepared",
            bytesReceived: 1_024,
            totalBytes: 1_024,
            verifiedAudioHash: null,
            errorCode: null,
        }).success).toBe(false);
    });

    it("validates per-player chart selection commands", () => {
        expect(relayCommandSchema.parse({
            protocolVersion: PROTOCOL_VERSION,
            commandId: "command-1",
            roomId: "room-1",
            expectedRoomRevision: 8,
            type: "player.chart.select",
            payload: {
                choice: {
                    selectionRevision: 3,
                    chartId: chart.chartId,
                    chartHash: chart.chartHash,
                },
            },
        }).type).toBe("player.chart.select");
    });

    it("accepts normalized runtime notes without local file references", () => {
        expect(runtimeSongPackagePayloadSchema.parse({
            assetProtocolVersion: ASSET_PROTOCOL_VERSION,
            songId: "song-1",
            offsetSeconds: 0,
            bpmSegments: [{ beat: 0, bpm: 120 }],
            charts: [{
                chartId: chart.chartId,
                chartHash: chart.chartHash,
                notes: [{ lane: 0, beat: 1, hitTimeSeconds: 0.5 }],
            }],
        }).charts[0]?.notes).toHaveLength(1);
    });
});
