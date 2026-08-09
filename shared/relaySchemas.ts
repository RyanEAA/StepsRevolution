import { z } from "zod";

import {
    CHART_IDENTITY_VERSION,
    PROTOCOL_VERSION,
} from "./constants";

export const ASSET_PROTOCOL_VERSION =
    "dance-vision-assets-v1" as const;

export const RELAY_ASSET_LIMITS = {
    artworkBytes: 5 * 1024 * 1024,
    previewAudioBytes: 2 * 1024 * 1024,
    songAudioBytes: 100 * 1024 * 1024,
    chartPackageBytes: 5 * 1024 * 1024,
} as const;

const identifierSchema = z.string().trim().min(1).max(128);
const assetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const chartHashSchema = z.string().regex(
    new RegExp(`^${CHART_IDENTITY_VERSION}:[a-f0-9]{64}$`),
);
const byteLength = (maximum: number) =>
    z.number().int().positive().max(maximum);

export const relayAssetKindSchema = z.enum([
    "artwork",
    "preview-audio",
    "song-audio",
    "chart-package",
]);

const assetBase = {
    assetId: assetIdSchema,
    sha256: sha256Schema,
    expiresAtServerMs: z.number().finite().positive(),
};

export const artworkAssetSchema = z.object({
    ...assetBase,
    kind: z.literal("artwork"),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteLength: byteLength(RELAY_ASSET_LIMITS.artworkBytes),
}).strict();

export const previewAudioAssetSchema = z.object({
    ...assetBase,
    kind: z.literal("preview-audio"),
    mimeType: z.enum([
        "audio/wav",
        "audio/mpeg",
        "audio/ogg",
        "audio/webm",
    ]),
    byteLength: byteLength(RELAY_ASSET_LIMITS.previewAudioBytes),
}).strict();

export const songAudioAssetSchema = z.object({
    ...assetBase,
    kind: z.literal("song-audio"),
    mimeType: z.string().trim().startsWith("audio/").max(100),
    byteLength: byteLength(RELAY_ASSET_LIMITS.songAudioBytes),
}).strict();

export const chartPackageAssetSchema = z.object({
    ...assetBase,
    kind: z.literal("chart-package"),
    mimeType: z.literal("application/json"),
    byteLength: byteLength(RELAY_ASSET_LIMITS.chartPackageBytes),
}).strict();

export const relayAssetSchema = z.discriminatedUnion("kind", [
    artworkAssetSchema,
    previewAudioAssetSchema,
    songAudioAssetSchema,
    chartPackageAssetSchema,
]);

export const relayAssetUploadProposalSchema = z.object({
    kind: relayAssetKindSchema,
    mimeType: z.string().trim().min(1).max(100),
    byteLength: z.number().int().positive(),
    sha256: sha256Schema,
}).strict().superRefine((value, context) => {
    const candidate = {
        ...value,
        assetId: "proposal_asset_123456",
        expiresAtServerMs: 1,
    };
    if (!relayAssetSchema.safeParse(candidate).success) {
        context.addIssue({
            code: "custom",
            message: "Asset kind, MIME type, or byte length is unsupported.",
        });
    }
});

export const roomPreviewSchema = z.object({
    assetProtocolVersion: z.literal(ASSET_PROTOCOL_VERSION),
    previewRevision: z.number().int().positive(),
    songId: identifierSchema,
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().max(200),
    artist: z.string().trim().max(200),
    artwork: artworkAssetSchema.nullable(),
    audioPreview: previewAudioAssetSchema.nullable(),
    previewDurationSeconds: z.number().finite().positive().max(30),
    publishedByPlayerId: identifierSchema,
    publishedAtServerMs: z.number().finite().nonnegative(),
}).strict();

export const sharedChartDescriptorSchema = z.object({
    chartId: identifierSchema,
    chartHash: chartHashSchema,
    stepType: z.literal("dance-single"),
    description: z.string().trim().max(200),
    difficulty: z.string().trim().min(1).max(80),
    meter: z.number().int().nonnegative(),
    tapCount: z.number().int().positive(),
    durationSeconds: z.number().finite().positive(),
}).strict();

const roomSongPackageObjectSchema = z.object({
    assetProtocolVersion: z.literal(ASSET_PROTOCOL_VERSION),
    selectionRevision: z.number().int().positive(),
    packageId: identifierSchema,
    songId: identifierSchema,
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().max(200),
    artist: z.string().trim().max(200),
    artwork: artworkAssetSchema.nullable(),
    audio: songAudioAssetSchema,
    chartPackage: chartPackageAssetSchema,
    charts: z.array(sharedChartDescriptorSchema).min(1).max(32),
    selectedByPlayerId: identifierSchema,
    selectedAtServerMs: z.number().finite().nonnegative(),
}).strict();

const validateUniqueCharts = (
    value: z.infer<typeof roomSongPackageObjectSchema>,
    context: z.RefinementCtx,
): void => {
    const chartIds = new Set<string>();
    const chartHashes = new Set<string>();
    value.charts.forEach((chart, index) => {
        if (chartIds.has(chart.chartId)) {
            context.addIssue({
                code: "custom",
                message: "Chart IDs must be unique within a song package.",
                path: ["charts", index, "chartId"],
            });
        }
        if (chartHashes.has(chart.chartHash)) {
            context.addIssue({
                code: "custom",
                message: "Chart hashes must be unique within a song package.",
                path: ["charts", index, "chartHash"],
            });
        }
        chartIds.add(chart.chartId);
        chartHashes.add(chart.chartHash);
    });
};

export const roomSongPackageSchema =
    roomSongPackageObjectSchema.superRefine(validateUniqueCharts);

export const proposedSongPackageSchema =
    roomSongPackageObjectSchema.omit({
        selectionRevision: true,
        selectedByPlayerId: true,
        selectedAtServerMs: true,
    }).superRefine((value, context) => {
        validateUniqueCharts({
            ...value,
            selectionRevision: 1,
            selectedByPlayerId: "proposal",
            selectedAtServerMs: 0,
        }, context);
    });

export const playerChartChoiceSchema = z.object({
    selectionRevision: z.number().int().positive(),
    chartId: identifierSchema,
    chartHash: chartHashSchema,
}).strict();

export const assetPreparationStatusSchema = z.enum([
    "not-requested",
    "downloading",
    "verifying",
    "prepared",
    "failed",
]);

export const playerAssetPreparationSchema = z.object({
    selectionRevision: z.number().int().positive(),
    status: assetPreparationStatusSchema,
    bytesReceived: z.number().int().nonnegative(),
    totalBytes: z.number().int().positive(),
    verifiedAudioHash: sha256Schema.nullable(),
    errorCode: z.string().trim().min(1).max(80).nullable(),
}).strict().superRefine((value, context) => {
    if (value.bytesReceived > value.totalBytes) {
        context.addIssue({
            code: "custom",
            message: "Received bytes cannot exceed total bytes.",
            path: ["bytesReceived"],
        });
    }
    if (value.status === "prepared" && !value.verifiedAudioHash) {
        context.addIssue({
            code: "custom",
            message: "Prepared audio must include its verified hash.",
            path: ["verifiedAudioHash"],
        });
    }
});

const relayCommandBase = {
    protocolVersion: z.literal(PROTOCOL_VERSION),
    commandId: identifierSchema,
    roomId: identifierSchema,
    expectedRoomRevision: z.number().int().nonnegative(),
};

export const relayCommandSchema = z.discriminatedUnion("type", [
    z.object({
        ...relayCommandBase,
        type: z.literal("preview.publish"),
        payload: z.object({
            preview: roomPreviewSchema.omit({
                previewRevision: true,
                publishedByPlayerId: true,
                publishedAtServerMs: true,
            }),
        }).strict(),
    }).strict(),
    z.object({
        ...relayCommandBase,
        type: z.literal("preview.clear"),
        payload: z.object({}).strict(),
    }).strict(),
    z.object({
        ...relayCommandBase,
        type: z.literal("songPackage.commit"),
        payload: z.object({
            songPackage: proposedSongPackageSchema,
        }).strict(),
    }).strict(),
    z.object({
        ...relayCommandBase,
        type: z.literal("player.chart.select"),
        payload: z.object({
            choice: playerChartChoiceSchema,
        }).strict(),
    }).strict(),
    z.object({
        ...relayCommandBase,
        type: z.literal("player.asset.status"),
        payload: z.object({
            preparation: playerAssetPreparationSchema,
        }).strict(),
    }).strict(),
]);

const bpmSegmentSchema = z.object({
    beat: z.number().finite(),
    bpm: z.number().finite().positive(),
}).strict();

const runtimeNoteSchema = z.object({
    lane: z.number().int().min(0).max(3),
    beat: z.number().finite().nonnegative(),
    hitTimeSeconds: z.number().finite().nonnegative(),
}).strict();

export const runtimeSongPackagePayloadSchema = z.object({
    assetProtocolVersion: z.literal(ASSET_PROTOCOL_VERSION),
    songId: identifierSchema,
    offsetSeconds: z.number().finite(),
    bpmSegments: z.array(bpmSegmentSchema).min(1),
    charts: z.array(z.object({
        chartId: identifierSchema,
        chartHash: chartHashSchema,
        notes: z.array(runtimeNoteSchema).min(1),
    }).strict()).min(1).max(32),
}).strict();

export type RelayAsset = z.infer<typeof relayAssetSchema>;
export type RelayAssetKind = z.infer<typeof relayAssetKindSchema>;
export type RelayAssetUploadProposal = z.infer<
    typeof relayAssetUploadProposalSchema
>;
export type RoomPreview = z.infer<typeof roomPreviewSchema>;
export type SharedChartDescriptor = z.infer<
    typeof sharedChartDescriptorSchema
>;
export type RoomSongPackage = z.infer<typeof roomSongPackageSchema>;
export type PlayerChartChoice = z.infer<typeof playerChartChoiceSchema>;
export type PlayerAssetPreparation = z.infer<
    typeof playerAssetPreparationSchema
>;
export type RelayCommand = z.infer<typeof relayCommandSchema>;
export type RuntimeSongPackagePayload = z.infer<
    typeof runtimeSongPackagePayloadSchema
>;
