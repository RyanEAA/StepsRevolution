import { z } from "zod";

import {
    CHART_IDENTITY_VERSION,
    PROTOCOL_VERSION,
} from "./constants";
import {
    relayAssetSchema,
    relayAssetUploadProposalSchema,
    roomPreviewSchema,
    roomSongPackageSchema,
    proposedSongPackageSchema,
    playerChartChoiceSchema,
    playerAssetPreparationSchema,
} from "./relaySchemas";

const identifierSchema = z.string().trim().min(1).max(128);
const revisionSchema = z.number().int().nonnegative();
const timestampSchema = z.number().finite().nonnegative();

export const roomPhaseSchema = z.enum([
    "selecting",
    "ready-check",
    "countdown",
    "playing",
    "results",
    "closed",
]);

export const connectionStatusSchema = z.enum([
    "connected",
    "disconnected",
]);

export const availabilityStatusSchema = z.enum([
    "unchecked",
    "checking",
    "matching-chart",
    "song-missing",
    "chart-missing",
    "chart-mismatch",
    "error",
]);

export const clockQualitySchema = z.enum([
    "unknown",
    "usable",
    "unusable",
]);

export const scheduleStatusSchema = z.enum([
    "not-scheduled",
    "scheduled",
    "failed",
]);

export const roomSelectionSchema = z.object({
    selectionRevision: revisionSchema.positive(),
    songId: identifierSchema,
    chartId: identifierSchema,
    chartHash: z.string().regex(
        new RegExp(
            `^${CHART_IDENTITY_VERSION}:[a-f0-9]{64}$`,
        ),
    ),
    identityVersion: z.literal(CHART_IDENTITY_VERSION),
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().max(200),
    artist: z.string().trim().max(200),
    stepType: z.literal("dance-single"),
    difficulty: z.string().trim().min(1).max(80),
    meter: z.number().int().nonnegative(),
    tapCount: z.number().int().positive(),
    durationSeconds: z.number().finite().positive(),
    selectedByPlayerId: identifierSchema,
    selectedAtServerMs: timestampSchema,
}).strict();

export const availabilitySchema = z.object({
    status: availabilityStatusSchema,
    selectionRevision: revisionSchema.nullable(),
    chartHash: z.string().nullable(),
    audioReady: z.boolean(),
}).strict();

export const liveScoreSchema = z.object({
    selectionRevision: revisionSchema.positive(),
    sequence: z.number().int().nonnegative(),
    score: z.number().int().nonnegative(),
    combo: z.number().int().nonnegative(),
    maxCombo: z.number().int().nonnegative(),
    perfectCount: z.number().int().nonnegative(),
    greatCount: z.number().int().nonnegative(),
    goodCount: z.number().int().nonnegative(),
    missCount: z.number().int().nonnegative(),
    gameTimeSeconds: z.number().finite().nonnegative(),
}).strict();

export const finalResultSchema = liveScoreSchema.extend({
    finishedAtServerMs: timestampSchema,
}).strict();

export const roomResultSchema = z.object({
    playerId: identifierSchema,
    result: finalResultSchema,
}).strict();

export const startScheduleSchema = z.object({
    selectionRevision: revisionSchema.positive(),
    startAtServerMs: timestampSchema,
    issuedAtServerMs: timestampSchema,
}).strict();

export const roomPlayerSchema = z.object({
    playerId: identifierSchema,
    displayName: z.string().trim().min(1).max(32),
    displayLabel: z.string().trim().min(1).max(40),
    joinedAtServerMs: timestampSchema,
    connectionStatus: connectionStatusSchema,
    disconnectedAtServerMs: timestampSchema.nullable(),
    availability: availabilitySchema,
    ready: z.boolean(),
    clockQuality: clockQualitySchema,
    scheduleStatus: scheduleStatusSchema,
    liveScore: liveScoreSchema.nullable(),
    finalResult: finalResultSchema.nullable(),
    replayRequested: z.boolean(),
    winCount: z.number().int().nonnegative(),
    chartChoice: playerChartChoiceSchema.nullable(),
    assetPreparation: playerAssetPreparationSchema.nullable(),
}).strict();

export const closeReasonSchema = z.enum([
    "host-closed",
    "room-empty",
    "room-expired",
    "kicked",
]);

export const roomStateSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    roomId: identifierSchema,
    roomCode: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/),
    revision: revisionSchema,
    selectionRevision: revisionSchema,
    previewRevision: revisionSchema,
    phase: roomPhaseSchema,
    hostPlayerId: identifierSchema,
    players: z.array(roomPlayerSchema),
    selection: roomSelectionSchema.nullable(),
    songPackage: roomSongPackageSchema.nullable(),
    preview: roomPreviewSchema.nullable(),
    startSchedule: startScheduleSchema.nullable(),
    results: z.array(roomResultSchema),
    resultsDeadlineAtServerMs: timestampSchema.nullable(),
    createdAtServerMs: timestampSchema,
    lastActivityAtServerMs: timestampSchema,
    expiresAtServerMs: timestampSchema,
    closeReason: closeReasonSchema.nullable(),
}).strict();

const commandBase = {
    protocolVersion: z.literal(PROTOCOL_VERSION),
    commandId: identifierSchema,
};

const roomCommandBase = {
    ...commandBase,
    roomId: identifierSchema,
};

const stateChangingCommandBase = {
    ...roomCommandBase,
    expectedRoomRevision: revisionSchema,
};

const command = <
    TType extends string,
    TBase extends z.ZodRawShape,
    TShape extends z.ZodRawShape,
>(
    type: TType,
    base: TBase,
    payload: TShape,
) => z.object({
    ...base,
    type: z.literal(type),
    payload: z.object(payload).strict(),
}).strict();

export const clientCommandSchema = z.discriminatedUnion("type", [
    command("room.create", commandBase, {
        displayName: z.string().trim().min(1).max(32),
    }),
    command("room.join", commandBase, {
        roomCode: z.string().trim().toUpperCase()
            .regex(/^[A-HJ-NP-Z2-9]{6}$/),
        displayName: z.string().trim().min(1).max(32),
    }),
    command("room.resume", commandBase, {
        roomId: identifierSchema,
        playerId: identifierSchema,
        reconnectToken: z.string().min(32).max(256),
    }),
    command("room.leave", roomCommandBase, {}),
    command("room.close", stateChangingCommandBase, {}),
    command("player.rename", stateChangingCommandBase, {
        displayName: z.string().trim().min(1).max(32),
    }),
    command("player.kick", stateChangingCommandBase, {
        playerId: identifierSchema,
    }),
    command("player.availability", stateChangingCommandBase, {
        availability: availabilitySchema,
    }),
    command("player.ready", stateChangingCommandBase, {
        ready: z.boolean(),
    }),
    command("player.clockQuality", stateChangingCommandBase, {
        usable: z.boolean(),
    }),
    command("selection.set", stateChangingCommandBase, {
        selection: roomSelectionSchema.omit({
            selectionRevision: true,
            selectedByPlayerId: true,
            selectedAtServerMs: true,
        }),
    }),
    command("selection.clear", stateChangingCommandBase, {}),
    command("preview.publish", stateChangingCommandBase, {
        preview: roomPreviewSchema.omit({
            previewRevision: true,
            publishedByPlayerId: true,
            publishedAtServerMs: true,
        }),
    }),
    command("preview.clear", stateChangingCommandBase, {}),
    command("songPackage.commit", stateChangingCommandBase, {
        songPackage: proposedSongPackageSchema,
    }),
    command("player.chart.select", stateChangingCommandBase, {
        choice: playerChartChoiceSchema,
    }),
    command("player.asset.status", stateChangingCommandBase, {
        preparation: playerAssetPreparationSchema,
    }),
    command("readyCheck.begin", stateChangingCommandBase, {}),
    command("readyCheck.cancel", stateChangingCommandBase, {}),
    command("countdown.request", stateChangingCommandBase, {}),
    command("countdown.cancel", stateChangingCommandBase, {}),
    command("countdown.scheduled", stateChangingCommandBase, {}),
    command("countdown.failed", stateChangingCommandBase, {}),
    command("game.score", roomCommandBase, {
        score: liveScoreSchema,
    }),
    command("game.finished", roomCommandBase, {
        result: finalResultSchema,
    }),
    command("results.replay", stateChangingCommandBase, {}),
    command("results.replayVote", stateChangingCommandBase, {
        wantsReplay: z.boolean(),
    }),
    command(
        "results.returnToSelection",
        stateChangingCommandBase,
        {},
    ),
    command("clock.ping", roomCommandBase, {
        clientSentAtPerformanceMs: timestampSchema,
    }),
    command("asset.upload.request", roomCommandBase, {
        asset: relayAssetUploadProposalSchema,
    }),
    command("asset.download.request", roomCommandBase, {
        assetId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    }),
]);

export const rejectionCodeSchema = z.enum([
    "invalid-command",
    "invalid-payload",
    "invalid-room-code",
    "room-not-found",
    "room-expired",
    "room-full",
    "game-in-progress",
    "not-a-member",
    "not-host",
    "invalid-phase",
    "stale-room-revision",
    "stale-selection-revision",
    "selection-required",
    "chart-not-matched",
    "audio-not-ready",
    "players-not-ready",
    "clock-not-synchronized",
    "start-schedule-failed",
    "display-name-invalid",
    "protocol-version-mismatch",
    "already-finished",
    "score-regressed",
    "rate-limited",
    "reconnect-token-invalid",
    "reconnect-grace-expired",
    "asset-not-found",
    "asset-not-ready",
    "asset-quota-exceeded",
]);

export const commandAcceptedSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("command.accepted"),
    commandId: identifierSchema,
    roomRevision: revisionSchema.nullable(),
    room: roomStateSchema.optional(),
}).strict();

export const commandRejectedSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("command.rejected"),
    commandId: identifierSchema,
    code: rejectionCodeSchema,
    message: z.string().min(1).max(240),
    roomRevision: revisionSchema.nullable(),
}).strict();

export const roomSnapshotMessageSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("room.snapshot"),
    room: roomStateSchema,
}).strict();

export const sessionCredentialsSchema = z.object({
    roomId: identifierSchema,
    playerId: identifierSchema,
    reconnectToken: z.string().min(32).max(256),
}).strict();

export const roomCreatedMessageSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("room.created"),
    room: roomStateSchema,
    credentials: sessionCredentialsSchema,
}).strict();

export const roomJoinedMessageSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("room.joined"),
    room: roomStateSchema,
    credentials: sessionCredentialsSchema,
}).strict();

export const roomResumedMessageSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("room.resumed"),
    room: roomStateSchema,
    credentials: sessionCredentialsSchema,
}).strict();

export const roomClosedMessageSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("room.closed"),
    roomId: identifierSchema,
    reason: closeReasonSchema,
    message: z.string().min(1).max(240),
}).strict();

export const clockPongMessageSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("clock.pong"),
    clientSentAtPerformanceMs: timestampSchema,
    serverReceivedAtMs: timestampSchema,
    serverSentAtMs: timestampSchema,
}).strict();

export const serverErrorMessageSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("server.error"),
    code: z.string().trim().min(1).max(80),
    message: z.string().min(1).max(240),
}).strict();

export const assetUploadGrantedMessageSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("asset.upload.granted"),
    commandId: identifierSchema,
    asset: relayAssetSchema,
    uploadTicket: z.string().min(32).max(256),
    uploadPath: z.string().regex(/^\/relay\/assets\/[A-Za-z0-9_-]{16,128}$/),
    ticketExpiresAtServerMs: timestampSchema,
}).strict();

export const assetDownloadGrantedMessageSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal("asset.download.granted"),
    commandId: identifierSchema,
    asset: relayAssetSchema,
    downloadTicket: z.string().min(32).max(256),
    downloadPath: z.string().regex(/^\/relay\/assets\/[A-Za-z0-9_-]{16,128}$/),
    ticketExpiresAtServerMs: timestampSchema,
}).strict();

export const serverMessageSchema = z.discriminatedUnion("type", [
    commandAcceptedSchema,
    commandRejectedSchema,
    roomCreatedMessageSchema,
    roomJoinedMessageSchema,
    roomResumedMessageSchema,
    roomSnapshotMessageSchema,
    roomClosedMessageSchema,
    clockPongMessageSchema,
    serverErrorMessageSchema,
    assetUploadGrantedMessageSchema,
    assetDownloadGrantedMessageSchema,
]);

export type RoomPhase = z.infer<typeof roomPhaseSchema>;
export type AvailabilityStatus = z.infer<
    typeof availabilityStatusSchema
>;
export type Availability = z.infer<typeof availabilitySchema>;
export type RoomSelection = z.infer<typeof roomSelectionSchema>;
export type RoomPreview = z.infer<typeof roomPreviewSchema>;
export type LiveScore = z.infer<typeof liveScoreSchema>;
export type FinalResult = z.infer<typeof finalResultSchema>;
export type RoomResult = z.infer<typeof roomResultSchema>;
export type RoomPlayer = z.infer<typeof roomPlayerSchema>;
export type RoomState = z.infer<typeof roomStateSchema>;
export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type RejectionCode = z.infer<typeof rejectionCodeSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type SessionCredentials = z.infer<
    typeof sessionCredentialsSchema
>;
