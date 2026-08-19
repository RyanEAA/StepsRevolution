// server/createDanceVisionServer.ts
import {
  createServer as createHttpServer
} from "http";
import { Server as SocketIoServer } from "socket.io";

// shared/constants.ts
var PROTOCOL_VERSION = 1;
var CHART_IDENTITY_VERSION = "dance-vision-runtime-chart-v1";
var MAX_ROOM_PLAYERS = 4;
var COUNTDOWN_DURATION_MS = 5e3;
var RECONNECT_GRACE_MS = 2e4;
var ROOM_INACTIVITY_MS = 30 * 6e4;

// shared/schemas.ts
import { z as z2 } from "zod";

// shared/relaySchemas.ts
import { z } from "zod";
var ASSET_PROTOCOL_VERSION = "dance-vision-assets-v1";
var RELAY_ASSET_LIMITS = {
  artworkBytes: 5 * 1024 * 1024,
  previewAudioBytes: 2 * 1024 * 1024,
  songAudioBytes: 100 * 1024 * 1024,
  chartPackageBytes: 5 * 1024 * 1024
};
var identifierSchema = z.string().trim().min(1).max(128);
var assetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
var sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
var chartHashSchema = z.string().regex(
  new RegExp(`^${CHART_IDENTITY_VERSION}:[a-f0-9]{64}$`)
);
var byteLength = (maximum) => z.number().int().positive().max(maximum);
var relayAssetKindSchema = z.enum([
  "artwork",
  "preview-audio",
  "song-audio",
  "chart-package"
]);
var assetBase = {
  assetId: assetIdSchema,
  sha256: sha256Schema,
  expiresAtServerMs: z.number().finite().positive()
};
var artworkAssetSchema = z.object({
  ...assetBase,
  kind: z.literal("artwork"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteLength: byteLength(RELAY_ASSET_LIMITS.artworkBytes)
}).strict();
var previewAudioAssetSchema = z.object({
  ...assetBase,
  kind: z.literal("preview-audio"),
  mimeType: z.enum([
    "audio/wav",
    "audio/mpeg",
    "audio/ogg",
    "audio/webm"
  ]),
  byteLength: byteLength(RELAY_ASSET_LIMITS.previewAudioBytes)
}).strict();
var songAudioAssetSchema = z.object({
  ...assetBase,
  kind: z.literal("song-audio"),
  mimeType: z.string().trim().startsWith("audio/").max(100),
  byteLength: byteLength(RELAY_ASSET_LIMITS.songAudioBytes)
}).strict();
var chartPackageAssetSchema = z.object({
  ...assetBase,
  kind: z.literal("chart-package"),
  mimeType: z.literal("application/json"),
  byteLength: byteLength(RELAY_ASSET_LIMITS.chartPackageBytes)
}).strict();
var relayAssetSchema = z.discriminatedUnion("kind", [
  artworkAssetSchema,
  previewAudioAssetSchema,
  songAudioAssetSchema,
  chartPackageAssetSchema
]);
var relayAssetUploadProposalSchema = z.object({
  kind: relayAssetKindSchema,
  mimeType: z.string().trim().min(1).max(100),
  byteLength: z.number().int().positive(),
  sha256: sha256Schema
}).strict().superRefine((value, context) => {
  const candidate = {
    ...value,
    assetId: "proposal_asset_123456",
    expiresAtServerMs: 1
  };
  if (!relayAssetSchema.safeParse(candidate).success) {
    context.addIssue({
      code: "custom",
      message: "Asset kind, MIME type, or byte length is unsupported."
    });
  }
});
var roomPreviewSchema = z.object({
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
  publishedAtServerMs: z.number().finite().nonnegative()
}).strict();
var sharedChartDescriptorSchema = z.object({
  chartId: identifierSchema,
  chartHash: chartHashSchema,
  stepType: z.literal("dance-single"),
  description: z.string().trim().max(200),
  difficulty: z.string().trim().min(1).max(80),
  meter: z.number().int().nonnegative(),
  tapCount: z.number().int().positive(),
  durationSeconds: z.number().finite().positive()
}).strict();
var roomSongPackageObjectSchema = z.object({
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
  selectedAtServerMs: z.number().finite().nonnegative()
}).strict();
var validateUniqueCharts = (value, context) => {
  const chartIds = /* @__PURE__ */ new Set();
  const chartHashes = /* @__PURE__ */ new Set();
  value.charts.forEach((chart, index) => {
    if (chartIds.has(chart.chartId)) {
      context.addIssue({
        code: "custom",
        message: "Chart IDs must be unique within a song package.",
        path: ["charts", index, "chartId"]
      });
    }
    if (chartHashes.has(chart.chartHash)) {
      context.addIssue({
        code: "custom",
        message: "Chart hashes must be unique within a song package.",
        path: ["charts", index, "chartHash"]
      });
    }
    chartIds.add(chart.chartId);
    chartHashes.add(chart.chartHash);
  });
};
var roomSongPackageSchema = roomSongPackageObjectSchema.superRefine(validateUniqueCharts);
var proposedSongPackageSchema = roomSongPackageObjectSchema.omit({
  selectionRevision: true,
  selectedByPlayerId: true,
  selectedAtServerMs: true
}).superRefine((value, context) => {
  validateUniqueCharts({
    ...value,
    selectionRevision: 1,
    selectedByPlayerId: "proposal",
    selectedAtServerMs: 0
  }, context);
});
var playerChartChoiceSchema = z.object({
  selectionRevision: z.number().int().positive(),
  chartId: identifierSchema,
  chartHash: chartHashSchema
}).strict();
var assetPreparationStatusSchema = z.enum([
  "not-requested",
  "downloading",
  "verifying",
  "prepared",
  "failed"
]);
var playerAssetPreparationSchema = z.object({
  selectionRevision: z.number().int().positive(),
  status: assetPreparationStatusSchema,
  bytesReceived: z.number().int().nonnegative(),
  totalBytes: z.number().int().positive(),
  verifiedAudioHash: sha256Schema.nullable(),
  errorCode: z.string().trim().min(1).max(80).nullable()
}).strict().superRefine((value, context) => {
  if (value.bytesReceived > value.totalBytes) {
    context.addIssue({
      code: "custom",
      message: "Received bytes cannot exceed total bytes.",
      path: ["bytesReceived"]
    });
  }
  if (value.status === "prepared" && !value.verifiedAudioHash) {
    context.addIssue({
      code: "custom",
      message: "Prepared audio must include its verified hash.",
      path: ["verifiedAudioHash"]
    });
  }
});
var relayCommandBase = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: identifierSchema,
  roomId: identifierSchema,
  expectedRoomRevision: z.number().int().nonnegative()
};
var relayCommandSchema = z.discriminatedUnion("type", [
  z.object({
    ...relayCommandBase,
    type: z.literal("preview.publish"),
    payload: z.object({
      preview: roomPreviewSchema.omit({
        previewRevision: true,
        publishedByPlayerId: true,
        publishedAtServerMs: true
      })
    }).strict()
  }).strict(),
  z.object({
    ...relayCommandBase,
    type: z.literal("preview.clear"),
    payload: z.object({}).strict()
  }).strict(),
  z.object({
    ...relayCommandBase,
    type: z.literal("songPackage.commit"),
    payload: z.object({
      songPackage: proposedSongPackageSchema
    }).strict()
  }).strict(),
  z.object({
    ...relayCommandBase,
    type: z.literal("player.chart.select"),
    payload: z.object({
      choice: playerChartChoiceSchema
    }).strict()
  }).strict(),
  z.object({
    ...relayCommandBase,
    type: z.literal("player.asset.status"),
    payload: z.object({
      preparation: playerAssetPreparationSchema
    }).strict()
  }).strict()
]);
var bpmSegmentSchema = z.object({
  beat: z.number().finite(),
  bpm: z.number().finite().positive()
}).strict();
var runtimeNoteSchema = z.object({
  lane: z.number().int().min(0).max(3),
  beat: z.number().finite().nonnegative(),
  hitTimeSeconds: z.number().finite().nonnegative()
}).strict();
var runtimeSongPackagePayloadSchema = z.object({
  assetProtocolVersion: z.literal(ASSET_PROTOCOL_VERSION),
  songId: identifierSchema,
  offsetSeconds: z.number().finite(),
  bpmSegments: z.array(bpmSegmentSchema).min(1),
  charts: z.array(z.object({
    chartId: identifierSchema,
    chartHash: chartHashSchema,
    notes: z.array(runtimeNoteSchema).min(1)
  }).strict()).min(1).max(32)
}).strict();

// shared/schemas.ts
var identifierSchema2 = z2.string().trim().min(1).max(128);
var revisionSchema = z2.number().int().nonnegative();
var timestampSchema = z2.number().finite().nonnegative();
var roomPhaseSchema = z2.enum([
  "selecting",
  "ready-check",
  "countdown",
  "playing",
  "results",
  "closed"
]);
var connectionStatusSchema = z2.enum([
  "connected",
  "disconnected"
]);
var availabilityStatusSchema = z2.enum([
  "unchecked",
  "checking",
  "matching-chart",
  "song-missing",
  "chart-missing",
  "chart-mismatch",
  "error"
]);
var clockQualitySchema = z2.enum([
  "unknown",
  "usable",
  "unusable"
]);
var scheduleStatusSchema = z2.enum([
  "not-scheduled",
  "scheduled",
  "failed"
]);
var roomSelectionSchema = z2.object({
  selectionRevision: revisionSchema.positive(),
  songId: identifierSchema2,
  chartId: identifierSchema2,
  chartHash: z2.string().regex(
    new RegExp(
      `^${CHART_IDENTITY_VERSION}:[a-f0-9]{64}$`
    )
  ),
  identityVersion: z2.literal(CHART_IDENTITY_VERSION),
  title: z2.string().trim().min(1).max(200),
  subtitle: z2.string().trim().max(200),
  artist: z2.string().trim().max(200),
  stepType: z2.literal("dance-single"),
  difficulty: z2.string().trim().min(1).max(80),
  meter: z2.number().int().nonnegative(),
  tapCount: z2.number().int().positive(),
  durationSeconds: z2.number().finite().positive(),
  selectedByPlayerId: identifierSchema2,
  selectedAtServerMs: timestampSchema
}).strict();
var availabilitySchema = z2.object({
  status: availabilityStatusSchema,
  selectionRevision: revisionSchema.nullable(),
  chartHash: z2.string().nullable(),
  audioReady: z2.boolean()
}).strict();
var liveScoreSchema = z2.object({
  selectionRevision: revisionSchema.positive(),
  sequence: z2.number().int().nonnegative(),
  score: z2.number().int().nonnegative(),
  combo: z2.number().int().nonnegative(),
  maxCombo: z2.number().int().nonnegative(),
  perfectCount: z2.number().int().nonnegative(),
  greatCount: z2.number().int().nonnegative(),
  goodCount: z2.number().int().nonnegative(),
  missCount: z2.number().int().nonnegative(),
  gameTimeSeconds: z2.number().finite().nonnegative()
}).strict();
var finalResultSchema = liveScoreSchema.extend({
  finishedAtServerMs: timestampSchema
}).strict();
var roomResultSchema = z2.object({
  playerId: identifierSchema2,
  result: finalResultSchema
}).strict();
var startScheduleSchema = z2.object({
  selectionRevision: revisionSchema.positive(),
  startAtServerMs: timestampSchema,
  issuedAtServerMs: timestampSchema
}).strict();
var roomPlayerSchema = z2.object({
  playerId: identifierSchema2,
  displayName: z2.string().trim().min(1).max(32),
  displayLabel: z2.string().trim().min(1).max(40),
  joinedAtServerMs: timestampSchema,
  connectionStatus: connectionStatusSchema,
  disconnectedAtServerMs: timestampSchema.nullable(),
  availability: availabilitySchema,
  ready: z2.boolean(),
  clockQuality: clockQualitySchema,
  scheduleStatus: scheduleStatusSchema,
  liveScore: liveScoreSchema.nullable(),
  finalResult: finalResultSchema.nullable(),
  replayRequested: z2.boolean(),
  winCount: z2.number().int().nonnegative(),
  chartChoice: playerChartChoiceSchema.nullable(),
  assetPreparation: playerAssetPreparationSchema.nullable()
}).strict();
var closeReasonSchema = z2.enum([
  "host-closed",
  "room-empty",
  "room-expired",
  "kicked"
]);
var roomStateSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  roomId: identifierSchema2,
  roomCode: z2.string().regex(/^[A-HJ-NP-Z2-9]{6}$/),
  revision: revisionSchema,
  selectionRevision: revisionSchema,
  previewRevision: revisionSchema,
  phase: roomPhaseSchema,
  hostPlayerId: identifierSchema2,
  players: z2.array(roomPlayerSchema),
  selection: roomSelectionSchema.nullable(),
  songPackage: roomSongPackageSchema.nullable(),
  preview: roomPreviewSchema.nullable(),
  startSchedule: startScheduleSchema.nullable(),
  results: z2.array(roomResultSchema),
  resultsDeadlineAtServerMs: timestampSchema.nullable(),
  createdAtServerMs: timestampSchema,
  lastActivityAtServerMs: timestampSchema,
  expiresAtServerMs: timestampSchema,
  closeReason: closeReasonSchema.nullable()
}).strict();
var commandBase = {
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  commandId: identifierSchema2
};
var roomCommandBase = {
  ...commandBase,
  roomId: identifierSchema2
};
var stateChangingCommandBase = {
  ...roomCommandBase,
  expectedRoomRevision: revisionSchema
};
var command = (type, base, payload) => z2.object({
  ...base,
  type: z2.literal(type),
  payload: z2.object(payload).strict()
}).strict();
var clientCommandSchema = z2.discriminatedUnion("type", [
  command("room.create", commandBase, {
    displayName: z2.string().trim().min(1).max(32)
  }),
  command("room.join", commandBase, {
    roomCode: z2.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{6}$/),
    displayName: z2.string().trim().min(1).max(32)
  }),
  command("room.resume", commandBase, {
    roomId: identifierSchema2,
    playerId: identifierSchema2,
    reconnectToken: z2.string().min(32).max(256)
  }),
  command("room.leave", roomCommandBase, {}),
  command("room.close", stateChangingCommandBase, {}),
  command("player.rename", stateChangingCommandBase, {
    displayName: z2.string().trim().min(1).max(32)
  }),
  command("player.kick", stateChangingCommandBase, {
    playerId: identifierSchema2
  }),
  command("player.availability", stateChangingCommandBase, {
    availability: availabilitySchema
  }),
  command("player.ready", stateChangingCommandBase, {
    ready: z2.boolean()
  }),
  command("player.clockQuality", stateChangingCommandBase, {
    usable: z2.boolean()
  }),
  command("selection.set", stateChangingCommandBase, {
    selection: roomSelectionSchema.omit({
      selectionRevision: true,
      selectedByPlayerId: true,
      selectedAtServerMs: true
    })
  }),
  command("selection.clear", stateChangingCommandBase, {}),
  command("preview.publish", stateChangingCommandBase, {
    preview: roomPreviewSchema.omit({
      previewRevision: true,
      publishedByPlayerId: true,
      publishedAtServerMs: true
    })
  }),
  command("preview.clear", stateChangingCommandBase, {}),
  command("songPackage.commit", stateChangingCommandBase, {
    songPackage: proposedSongPackageSchema
  }),
  command("player.chart.select", stateChangingCommandBase, {
    choice: playerChartChoiceSchema
  }),
  command("player.asset.status", stateChangingCommandBase, {
    preparation: playerAssetPreparationSchema
  }),
  command("readyCheck.begin", stateChangingCommandBase, {}),
  command("readyCheck.cancel", stateChangingCommandBase, {}),
  command("countdown.request", stateChangingCommandBase, {}),
  command("countdown.cancel", stateChangingCommandBase, {}),
  command("countdown.scheduled", stateChangingCommandBase, {}),
  command("countdown.failed", stateChangingCommandBase, {}),
  command("game.score", roomCommandBase, {
    score: liveScoreSchema
  }),
  command("game.finished", roomCommandBase, {
    result: finalResultSchema
  }),
  command("results.replay", stateChangingCommandBase, {}),
  command("results.replayVote", stateChangingCommandBase, {
    wantsReplay: z2.boolean()
  }),
  command(
    "results.returnToSelection",
    stateChangingCommandBase,
    {}
  ),
  command("clock.ping", roomCommandBase, {
    clientSentAtPerformanceMs: timestampSchema
  }),
  command("asset.upload.request", roomCommandBase, {
    asset: relayAssetUploadProposalSchema
  }),
  command("asset.download.request", roomCommandBase, {
    assetId: z2.string().regex(/^[A-Za-z0-9_-]{16,128}$/)
  })
]);
var rejectionCodeSchema = z2.enum([
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
  "asset-quota-exceeded"
]);
var commandAcceptedSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("command.accepted"),
  commandId: identifierSchema2,
  roomRevision: revisionSchema.nullable(),
  room: roomStateSchema.optional()
}).strict();
var commandRejectedSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("command.rejected"),
  commandId: identifierSchema2,
  code: rejectionCodeSchema,
  message: z2.string().min(1).max(240),
  roomRevision: revisionSchema.nullable()
}).strict();
var roomSnapshotMessageSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("room.snapshot"),
  room: roomStateSchema
}).strict();
var sessionCredentialsSchema = z2.object({
  roomId: identifierSchema2,
  playerId: identifierSchema2,
  reconnectToken: z2.string().min(32).max(256)
}).strict();
var roomCreatedMessageSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("room.created"),
  room: roomStateSchema,
  credentials: sessionCredentialsSchema
}).strict();
var roomJoinedMessageSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("room.joined"),
  room: roomStateSchema,
  credentials: sessionCredentialsSchema
}).strict();
var roomResumedMessageSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("room.resumed"),
  room: roomStateSchema,
  credentials: sessionCredentialsSchema
}).strict();
var roomClosedMessageSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("room.closed"),
  roomId: identifierSchema2,
  reason: closeReasonSchema,
  message: z2.string().min(1).max(240)
}).strict();
var clockPongMessageSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("clock.pong"),
  clientSentAtPerformanceMs: timestampSchema,
  serverReceivedAtMs: timestampSchema,
  serverSentAtMs: timestampSchema
}).strict();
var serverErrorMessageSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("server.error"),
  code: z2.string().trim().min(1).max(80),
  message: z2.string().min(1).max(240)
}).strict();
var assetUploadGrantedMessageSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("asset.upload.granted"),
  commandId: identifierSchema2,
  asset: relayAssetSchema,
  uploadTicket: z2.string().min(32).max(256),
  uploadPath: z2.string().regex(/^\/relay\/assets\/[A-Za-z0-9_-]{16,128}$/),
  ticketExpiresAtServerMs: timestampSchema
}).strict();
var assetDownloadGrantedMessageSchema = z2.object({
  protocolVersion: z2.literal(PROTOCOL_VERSION),
  type: z2.literal("asset.download.granted"),
  commandId: identifierSchema2,
  asset: relayAssetSchema,
  downloadTicket: z2.string().min(32).max(256),
  downloadPath: z2.string().regex(/^\/relay\/assets\/[A-Za-z0-9_-]{16,128}$/),
  ticketExpiresAtServerMs: timestampSchema
}).strict();
var serverMessageSchema = z2.discriminatedUnion("type", [
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
  assetDownloadGrantedMessageSchema
]);

// server/assetRelayService.ts
import {
  createHash,
  randomBytes,
  randomUUID
} from "crypto";
import {
  createReadStream,
  createWriteStream
} from "fs";
import {
  mkdir,
  readdir,
  rename,
  rm,
  stat
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
var DEFAULT_TICKET_TTL_MS = 6e4;
var DEFAULT_ASSET_TTL_MS = 30 * 6e4;
var DEFAULT_ROOM_QUOTA_BYTES = 200 * 1024 * 1024;
var AssetRelayError = class extends Error {
  code;
  statusCode;
  constructor(code, message, statusCode) {
    super(message);
    this.name = "AssetRelayError";
    this.code = code;
    this.statusCode = statusCode;
  }
};
var AssetRelayService = class {
  rootDirectory;
  now;
  createAssetId;
  createTicket;
  ticketTtlMs;
  assetTtlMs;
  roomQuotaBytes;
  cleanupOnStart;
  assets = /* @__PURE__ */ new Map();
  tickets = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.rootDirectory = options.rootDirectory ?? join(tmpdir(), "dance-vision-relay");
    this.now = options.now ?? Date.now;
    this.createAssetId = options.createAssetId ?? (() => randomUUID());
    this.createTicket = options.createTicket ?? (() => randomBytes(32).toString("hex"));
    this.ticketTtlMs = options.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS;
    this.assetTtlMs = options.assetTtlMs ?? DEFAULT_ASSET_TTL_MS;
    this.roomQuotaBytes = options.roomQuotaBytes ?? DEFAULT_ROOM_QUOTA_BYTES;
    this.cleanupOnStart = options.cleanupOnStart ?? true;
  }
  async start() {
    await mkdir(this.rootDirectory, { recursive: true });
    if (this.cleanupOnStart) {
      const entries = await readdir(this.rootDirectory);
      await Promise.all(entries.map(
        (entry) => rm(join(this.rootDirectory, entry), {
          recursive: true,
          force: true
        })
      ));
    }
  }
  reserveUpload(roomId, playerId, rawProposal) {
    const proposal = relayAssetUploadProposalSchema.parse(rawProposal);
    const roomBytes = [...this.assets.values()].filter((record) => record.roomId === roomId).reduce((total, record) => total + record.asset.byteLength, 0);
    if (roomBytes + proposal.byteLength > this.roomQuotaBytes) {
      throw new AssetRelayError(
        "asset-quota-exceeded",
        "The room asset quota would be exceeded.",
        413
      );
    }
    const assetId = this.createAssetId();
    const expiresAtServerMs = this.now() + this.assetTtlMs;
    const asset = relayAssetSchema.parse({
      ...proposal,
      assetId,
      expiresAtServerMs
    });
    this.assets.set(assetId, {
      roomId,
      playerId,
      asset,
      status: "reserved",
      filePath: null
    });
    const grant = this.createGrantTicket(
      "upload",
      roomId,
      playerId,
      assetId
    );
    return {
      asset,
      uploadTicket: grant.ticket,
      uploadPath: `/relay/assets/${assetId}`,
      ticketExpiresAtServerMs: grant.expiresAtServerMs
    };
  }
  grantDownload(roomId, playerId, assetId) {
    const record = this.assets.get(assetId);
    if (!record || record.roomId !== roomId) {
      throw new AssetRelayError(
        "asset-not-found",
        "The requested room asset does not exist.",
        404
      );
    }
    if (record.status !== "ready" || !record.filePath) {
      throw new AssetRelayError(
        "asset-not-ready",
        "The requested room asset is not ready.",
        409
      );
    }
    const grant = this.createGrantTicket(
      "download",
      roomId,
      playerId,
      assetId
    );
    return {
      asset: record.asset,
      downloadTicket: grant.ticket,
      downloadPath: `/relay/assets/${assetId}`,
      ticketExpiresAtServerMs: grant.expiresAtServerMs
    };
  }
  async handleHttp(request, response) {
    const match = request.url?.match(
      /^\/relay\/assets\/([A-Za-z0-9_-]{16,128})$/
    );
    if (!match) return false;
    try {
      if (request.method === "PUT") {
        await this.handleUpload(request, response, match[1]);
        return true;
      }
      if (request.method === "GET") {
        await this.handleDownload(request, response, match[1]);
        return true;
      }
      this.json(response, 405, { error: "method-not-allowed" }, {
        allow: "PUT, GET"
      });
    } catch (error) {
      const relayError = error instanceof AssetRelayError ? error : new AssetRelayError(
        "invalid-payload",
        error instanceof Error ? error.message : "The asset transfer failed.",
        400
      );
      if (!response.headersSent) {
        this.json(response, relayError.statusCode, {
          error: relayError.code,
          message: relayError.message
        });
      } else {
        response.destroy();
      }
    }
    return true;
  }
  getReadyAsset(roomId, assetId) {
    const record = this.assets.get(assetId);
    return record?.roomId === roomId && record.status === "ready" ? record.asset : null;
  }
  async deleteRoom(roomId) {
    const records = [...this.assets.entries()].filter(
      ([, record]) => record.roomId === roomId
    );
    for (const [assetId] of records) this.assets.delete(assetId);
    for (const [ticket, value] of this.tickets) {
      if (value.roomId === roomId) this.tickets.delete(ticket);
    }
    if (records.length > 0) {
      await rm(this.roomDirectory(roomId), {
        recursive: true,
        force: true
      });
    }
  }
  async deleteAsset(roomId, assetId) {
    const record = this.assets.get(assetId);
    if (!record || record.roomId !== roomId) {
      return;
    }
    this.assets.delete(assetId);
    for (const [ticket, value] of this.tickets) {
      if (value.assetId === assetId) {
        this.tickets.delete(ticket);
      }
    }
    if (record.filePath) {
      await rm(record.filePath, {
        force: true
      });
    }
    const hasRemainingAssets = [...this.assets.values()].some(
      (candidate) => candidate.roomId === roomId
    );
    if (!hasRemainingAssets) {
      await rm(this.roomDirectory(roomId), {
        recursive: true,
        force: true
      });
    }
  }
  async cleanupExpired() {
    const nowMs = this.now();
    for (const [ticket, value] of this.tickets) {
      if (value.expiresAtServerMs <= nowMs || value.consumed) {
        this.tickets.delete(ticket);
      }
    }
    const expiredRooms = /* @__PURE__ */ new Set();
    for (const [assetId, record] of this.assets) {
      if (record.asset.expiresAtServerMs <= nowMs) {
        this.assets.delete(assetId);
        expiredRooms.add(record.roomId);
      }
    }
    for (const roomId of expiredRooms) {
      const hasRemaining = [...this.assets.values()].some(
        (record) => record.roomId === roomId
      );
      if (!hasRemaining) {
        await rm(this.roomDirectory(roomId), {
          recursive: true,
          force: true
        });
      }
    }
  }
  async handleUpload(request, response, assetId) {
    const ticket = this.authorize(request, "upload", assetId);
    const record = this.assets.get(assetId);
    const declaredLength = Number.parseInt(
      request.headers["content-length"] ?? "",
      10
    );
    if (!Number.isInteger(declaredLength)) {
      throw new AssetRelayError(
        "invalid-payload",
        "Content-Length is required.",
        411
      );
    }
    if (declaredLength !== record.asset.byteLength) {
      throw new AssetRelayError(
        "invalid-payload",
        "Content-Length does not match the asset reservation.",
        400
      );
    }
    const contentType = request.headers["content-type"]?.split(";")[0];
    if (contentType !== record.asset.mimeType) {
      throw new AssetRelayError(
        "invalid-payload",
        "Content-Type does not match the asset reservation.",
        415
      );
    }
    ticket.consumed = true;
    const roomDirectory = this.roomDirectory(record.roomId);
    await mkdir(roomDirectory, { recursive: true });
    const temporaryPath = join(
      roomDirectory,
      `${assetId}.${randomBytes(8).toString("hex")}.partial`
    );
    const finalPath = join(roomDirectory, assetId);
    const hash = createHash("sha256");
    let received = 0;
    const verifier = new Transform({
      transform: (chunk, _encoding, callback) => {
        received += chunk.length;
        if (received > record.asset.byteLength) {
          callback(new Error("Upload exceeded its reserved size."));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    try {
      await pipeline(
        request,
        verifier,
        createWriteStream(temporaryPath, { flags: "wx" })
      );
      if (received !== record.asset.byteLength) {
        throw new Error("Upload ended before the reserved size.");
      }
      const digest = `sha256:${hash.digest("hex")}`;
      if (digest !== record.asset.sha256) {
        throw new Error("Uploaded asset SHA-256 did not match.");
      }
      await rename(temporaryPath, finalPath);
      record.status = "ready";
      record.filePath = finalPath;
      this.json(response, 201, { asset: record.asset });
    } catch (error) {
      await rm(temporaryPath, { force: true });
      this.assets.delete(assetId);
      throw error;
    }
  }
  async handleDownload(request, response, assetId) {
    this.authorize(request, "download", assetId);
    const record = this.assets.get(assetId);
    if (!record || record.status !== "ready" || !record.filePath) {
      throw new AssetRelayError(
        "asset-not-ready",
        "The requested room asset is not ready.",
        409
      );
    }
    const file = await stat(record.filePath);
    const range = this.parseRange(request.headers.range, file.size);
    response.writeHead(range ? 206 : 200, {
      "content-type": record.asset.mimeType,
      "content-length": range ? range.end - range.start + 1 : file.size,
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      ...range ? {
        "content-range": `bytes ${range.start}-${range.end}/${file.size}`
      } : {}
    });
    await pipeline(
      createReadStream(record.filePath, range ?? void 0),
      response
    );
  }
  authorize(request, operation, assetId) {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const ticket = this.tickets.get(token);
    if (!ticket || ticket.operation !== operation || ticket.assetId !== assetId || ticket.consumed || ticket.expiresAtServerMs <= this.now()) {
      throw new AssetRelayError(
        "invalid-payload",
        "The asset transfer ticket is invalid or expired.",
        401
      );
    }
    return ticket;
  }
  createGrantTicket(operation, roomId, playerId, assetId) {
    const ticket = this.createTicket();
    const expiresAtServerMs = this.now() + this.ticketTtlMs;
    this.tickets.set(ticket, {
      operation,
      roomId,
      playerId,
      assetId,
      expiresAtServerMs,
      consumed: false
    });
    return { ticket, expiresAtServerMs };
  }
  roomDirectory(roomId) {
    const safeRoomKey = createHash("sha256").update(roomId).digest("hex");
    return join(this.rootDirectory, safeRoomKey);
  }
  parseRange(header, fileSize) {
    if (!header) return null;
    const match = header.match(/^bytes=(\d+)-(\d*)$/);
    if (!match) {
      throw new AssetRelayError(
        "invalid-payload",
        "Only one explicit byte range is supported.",
        416
      );
    }
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
    if (start < 0 || end < start || end >= fileSize) {
      throw new AssetRelayError(
        "invalid-payload",
        "The requested byte range is unsatisfiable.",
        416
      );
    }
    return { start, end };
  }
  json(response, statusCode, body, headers = {}) {
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    });
    response.end(JSON.stringify(body));
  }
};

// server/roomRegistry.ts
import {
  randomBytes as randomBytes2,
  randomInt,
  randomUUID as randomUUID2
} from "crypto";

// server/domain/roomStateMachine.ts
function createRoomState(options) {
  const host = createPlayer(
    options.hostPlayerId,
    options.hostDisplayName,
    options.nowMs
  );
  return {
    protocolVersion: PROTOCOL_VERSION,
    roomId: options.roomId,
    roomCode: options.roomCode,
    revision: 0,
    selectionRevision: 0,
    previewRevision: 0,
    phase: "selecting",
    hostPlayerId: options.hostPlayerId,
    players: [host],
    selection: null,
    songPackage: null,
    preview: null,
    startSchedule: null,
    results: [],
    resultsDeadlineAtServerMs: null,
    createdAtServerMs: options.nowMs,
    lastActivityAtServerMs: options.nowMs,
    expiresAtServerMs: options.nowMs + ROOM_INACTIVITY_MS,
    closeReason: null
  };
}
function transitionRoom(state, action) {
  if (state.phase === "closed") {
    return reject(state, "invalid-phase", "The room is closed.");
  }
  if (isActorAction(action)) {
    const actor = findPlayer(state, action.actorPlayerId);
    if (!actor) {
      return reject(
        state,
        "not-a-member",
        "The player is not a member of this room."
      );
    }
    if (action.expectedRoomRevision !== state.revision) {
      return reject(
        state,
        "stale-room-revision",
        "The room changed before this command was processed."
      );
    }
  }
  switch (action.type) {
    case "player.join":
      return joinPlayer(state, action);
    case "player.disconnect":
      return disconnectPlayer(state, action.playerId, action.nowMs);
    case "player.resume":
      return resumePlayer(state, action.playerId, action.nowMs);
    case "player.leave":
      return leavePlayer(state, action.actorPlayerId, action.nowMs);
    case "player.rename":
      return renamePlayer(state, action);
    case "player.kick":
      return kickPlayer(state, action);
    case "player.availability":
      return reportAvailability(state, action);
    case "player.ready":
      return setReady(state, action);
    case "player.clockQuality":
      return setClockQuality(state, action);
    case "selection.set":
      return setSelection(state, action);
    case "selection.clear":
      return clearSelection(state, action);
    case "preview.publish":
      return publishPreview(state, action);
    case "preview.clear":
      return clearPreview(state, action);
    case "songPackage.commit":
      return commitSongPackage(state, action);
    case "player.chart.select":
      return selectPlayerChart(state, action);
    case "player.asset.status":
      return setPlayerAssetStatus(state, action);
    case "readyCheck.begin":
      return beginReadyCheck(state, action);
    case "readyCheck.cancel":
      return cancelReadyCheck(state, action);
    case "countdown.request":
      return requestCountdown(state, action);
    case "countdown.scheduled":
      return confirmScheduled(state, action);
    case "countdown.cancel":
      return cancelCountdown(state, action);
    case "countdown.failed":
      return failCountdown(state, action);
    case "game.score":
      return reportScore(state, action);
    case "game.finished":
      return reportFinished(state, action);
    case "results.replay":
      return replay(state, action);
    case "results.replayVote":
      return voteReplay(state, action);
    case "results.returnToSelection":
      return returnToSelection(state, action);
    case "room.close":
      return closeByHost(state, action);
    case "server.tick":
      return advanceServerTime(state, action.nowMs);
  }
}
function joinPlayer(state, action) {
  if (state.phase !== "selecting" && state.phase !== "ready-check") {
    return reject(
      state,
      "game-in-progress",
      "Players cannot join this room right now."
    );
  }
  if (state.players.length >= MAX_ROOM_PLAYERS) {
    return reject(state, "room-full", "The room is full.");
  }
  if (findPlayer(state, action.playerId)) {
    return reject(
      state,
      "invalid-command",
      "That player is already in the room."
    );
  }
  const next = cloneState(state);
  next.players.push(
    createPlayer(action.playerId, action.displayName, action.nowMs)
  );
  updateDisplayLabels(next.players);
  return acceptChanged(next, action.nowMs);
}
function disconnectPlayer(state, playerId, nowMs) {
  const player = findPlayer(state, playerId);
  if (!player) {
    return reject(state, "not-a-member", "Unknown player.");
  }
  if (player.connectionStatus === "disconnected") {
    return { accepted: true, state };
  }
  const next = cloneState(state);
  const nextPlayer = findPlayer(next, playerId);
  nextPlayer.connectionStatus = "disconnected";
  nextPlayer.disconnectedAtServerMs = nowMs;
  nextPlayer.ready = false;
  if (next.phase === "countdown") {
    resetToReadyCheck(next);
  }
  return acceptChanged(next, nowMs);
}
function resumePlayer(state, playerId, nowMs) {
  const player = findPlayer(state, playerId);
  if (!player) {
    return reject(state, "not-a-member", "Unknown player.");
  }
  if (player.connectionStatus === "connected") {
    return { accepted: true, state };
  }
  if (player.disconnectedAtServerMs === null || nowMs - player.disconnectedAtServerMs > RECONNECT_GRACE_MS) {
    return reject(
      state,
      "reconnect-grace-expired",
      "The reconnect window has expired."
    );
  }
  const next = cloneState(state);
  const nextPlayer = findPlayer(next, playerId);
  nextPlayer.connectionStatus = "connected";
  nextPlayer.disconnectedAtServerMs = null;
  return acceptChanged(next, nowMs);
}
function leavePlayer(state, playerId, nowMs) {
  const next = cloneState(state);
  next.players = next.players.filter(
    (player) => player.playerId !== playerId
  );
  if (next.players.length === 0) {
    closeRoom(next, "room-empty");
    return acceptChanged(next, nowMs);
  }
  if (next.hostPlayerId === playerId) {
    transferHost(next);
  }
  if (next.phase === "countdown") {
    resetToReadyCheck(next);
  }
  updateDisplayLabels(next.players);
  return acceptChanged(next, nowMs);
}
function renamePlayer(state, action) {
  if (state.phase !== "selecting" && state.phase !== "ready-check") {
    return reject(state, "invalid-phase", "Names cannot change now.");
  }
  const displayName = action.displayName.trim();
  if (displayName.length < 1 || displayName.length > 32) {
    return reject(
      state,
      "display-name-invalid",
      "Display names must contain 1 to 32 characters."
    );
  }
  const next = cloneState(state);
  findPlayer(next, action.actorPlayerId).displayName = displayName;
  updateDisplayLabels(next.players);
  return acceptChanged(next, action.nowMs);
}
function kickPlayer(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (action.playerId === state.hostPlayerId) {
    return reject(state, "invalid-payload", "The host cannot kick themselves.");
  }
  if (state.phase !== "selecting" && state.phase !== "ready-check" && state.phase !== "results") {
    return reject(state, "invalid-phase", "Players cannot be removed during a countdown or song.");
  }
  if (!findPlayer(state, action.playerId)) {
    return reject(state, "not-a-member", "That player is no longer in the room.");
  }
  const next = cloneState(state);
  next.players = next.players.filter((player) => player.playerId !== action.playerId);
  updateDisplayLabels(next.players);
  return acceptChanged(next, action.nowMs);
}
function reportAvailability(state, action) {
  if (state.phase !== "selecting" && state.phase !== "ready-check") {
    return reject(
      state,
      "invalid-phase",
      "Chart availability cannot change now."
    );
  }
  if (!state.selection || action.availability.selectionRevision !== state.selectionRevision) {
    return reject(
      state,
      "stale-selection-revision",
      "Availability was checked for an old selection."
    );
  }
  if (action.availability.status === "matching-chart" && action.availability.chartHash !== state.selection.chartHash) {
    return reject(
      state,
      "chart-not-matched",
      "The reported chart hash does not match the room selection."
    );
  }
  const next = cloneState(state);
  const player = findPlayer(next, action.actorPlayerId);
  player.availability = { ...action.availability };
  player.ready = false;
  return acceptChanged(next, action.nowMs);
}
function setReady(state, action) {
  if (state.phase !== "ready-check") {
    return reject(
      state,
      "invalid-phase",
      "Readiness can only change during ready check."
    );
  }
  const player = findPlayer(state, action.actorPlayerId);
  if (action.ready && !hasMatchingChart(player, state)) {
    return reject(
      state,
      "chart-not-matched",
      "An exact chart match is required before becoming ready."
    );
  }
  if (action.ready && !state.songPackage && !player.availability.audioReady) {
    return reject(
      state,
      "audio-not-ready",
      "Local audio must be ready before becoming ready."
    );
  }
  const next = cloneState(state);
  findPlayer(next, action.actorPlayerId).ready = action.ready;
  return acceptChanged(next, action.nowMs);
}
function setClockQuality(state, action) {
  const next = cloneState(state);
  findPlayer(next, action.actorPlayerId).clockQuality = action.usable ? "usable" : "unusable";
  return acceptChanged(next, action.nowMs);
}
function setSelection(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "selecting" && state.phase !== "ready-check") {
    return reject(state, "invalid-phase", "Selection is locked now.");
  }
  const proposedSelection = {
    ...action.selection,
    selectionRevision: state.selectionRevision + 1,
    selectedByPlayerId: action.actorPlayerId,
    selectedAtServerMs: action.nowMs
  };
  if (!roomSelectionSchema.safeParse(proposedSelection).success) {
    return reject(
      state,
      "invalid-payload",
      "The chart identity version is unsupported."
    );
  }
  const next = cloneState(state);
  next.selectionRevision += 1;
  next.selection = proposedSelection;
  next.songPackage = null;
  next.phase = "selecting";
  resetPlayersForSelection(next.players);
  clearGameplayState(next);
  return acceptChanged(next, action.nowMs);
}
function clearSelection(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "selecting" && state.phase !== "ready-check") {
    return reject(state, "invalid-phase", "Selection is locked now.");
  }
  const next = cloneState(state);
  next.selectionRevision += 1;
  next.selection = null;
  next.songPackage = null;
  next.phase = "selecting";
  resetPlayersForSelection(next.players);
  clearGameplayState(next);
  return acceptChanged(next, action.nowMs);
}
function publishPreview(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "selecting" && state.phase !== "ready-check") {
    return reject(state, "invalid-phase", "Song previews are locked now.");
  }
  const next = cloneState(state);
  next.previewRevision += 1;
  next.preview = {
    ...action.preview,
    previewRevision: next.previewRevision,
    publishedByPlayerId: action.actorPlayerId,
    publishedAtServerMs: action.nowMs
  };
  return acceptChanged(next, action.nowMs);
}
function clearPreview(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "selecting" && state.phase !== "ready-check") {
    return reject(state, "invalid-phase", "Song previews are locked now.");
  }
  if (!state.preview) return { accepted: true, state };
  const next = cloneState(state);
  next.previewRevision += 1;
  next.preview = null;
  return acceptChanged(next, action.nowMs);
}
function commitSongPackage(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "selecting" && state.phase !== "ready-check") {
    return reject(state, "invalid-phase", "The room song is locked now.");
  }
  const songPackage = {
    ...action.songPackage,
    selectionRevision: state.selectionRevision + 1,
    selectedByPlayerId: action.actorPlayerId,
    selectedAtServerMs: action.nowMs
  };
  if (!roomSongPackageSchema.safeParse(songPackage).success) {
    return reject(state, "invalid-payload", "The shared song package is invalid.");
  }
  const next = cloneState(state);
  next.selectionRevision += 1;
  next.selection = null;
  next.songPackage = songPackage;
  next.preview = null;
  next.previewRevision += 1;
  next.phase = "ready-check";
  resetPlayersForSelection(next.players);
  next.players.forEach((player) => {
    player.chartChoice = null;
    player.assetPreparation = null;
  });
  clearGameplayState(next);
  return acceptChanged(next, action.nowMs);
}
function selectPlayerChart(state, action) {
  if (state.phase !== "selecting" && state.phase !== "ready-check") {
    return reject(state, "invalid-phase", "Difficulty selection is locked now.");
  }
  if (!state.songPackage || action.choice.selectionRevision !== state.selectionRevision) {
    return reject(state, "stale-selection-revision", "Choose a difficulty from the current song.");
  }
  const matches = state.songPackage.charts.some((chart) => chart.chartId === action.choice.chartId && chart.chartHash === action.choice.chartHash);
  if (!matches) return reject(state, "chart-not-matched", "That difficulty is not part of the room song.");
  const next = cloneState(state);
  const player = findPlayer(next, action.actorPlayerId);
  player.chartChoice = { ...action.choice };
  player.ready = false;
  return acceptChanged(next, action.nowMs);
}
function setPlayerAssetStatus(state, action) {
  if (!state.songPackage || action.preparation.selectionRevision !== state.selectionRevision) {
    return reject(state, "stale-selection-revision", "Asset status belongs to an old song.");
  }
  const next = cloneState(state);
  const player = findPlayer(next, action.actorPlayerId);
  player.assetPreparation = { ...action.preparation };
  player.ready = false;
  return acceptChanged(next, action.nowMs);
}
function beginReadyCheck(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "selecting") {
    return reject(state, "invalid-phase", "Ready check cannot begin now.");
  }
  if (!state.selection && !state.songPackage) {
    return reject(
      state,
      "selection-required",
      "Confirm a song before beginning ready check."
    );
  }
  const next = cloneState(state);
  next.phase = "ready-check";
  next.players.forEach((player) => {
    player.ready = false;
  });
  return acceptChanged(next, action.nowMs);
}
function cancelReadyCheck(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "ready-check") {
    return reject(state, "invalid-phase", "No ready check is active.");
  }
  const next = cloneState(state);
  next.phase = "selecting";
  next.players.forEach((player) => {
    player.ready = false;
  });
  return acceptChanged(next, action.nowMs);
}
function requestCountdown(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "ready-check") {
    return reject(state, "invalid-phase", "Countdown cannot begin now.");
  }
  if (!state.selection && !state.songPackage) {
    return reject(state, "selection-required", "No chart is selected.");
  }
  const connectedPlayers = state.players.filter(
    (player) => player.connectionStatus === "connected"
  );
  if (connectedPlayers.length !== state.players.length || connectedPlayers.some(
    (player) => !player.ready || !hasMatchingChart(player, state)
  )) {
    return reject(
      state,
      "players-not-ready",
      "Every player must be connected, matched, and ready."
    );
  }
  if (connectedPlayers.some(
    (player) => player.clockQuality !== "usable"
  )) {
    return reject(
      state,
      "clock-not-synchronized",
      "Every player needs usable clock synchronization."
    );
  }
  const next = cloneState(state);
  next.phase = "countdown";
  next.startSchedule = {
    selectionRevision: next.selectionRevision,
    issuedAtServerMs: action.nowMs,
    startAtServerMs: action.nowMs + COUNTDOWN_DURATION_MS
  };
  next.players.forEach((player) => {
    player.scheduleStatus = "not-scheduled";
    player.liveScore = null;
    player.finalResult = null;
  });
  next.results = [];
  next.resultsDeadlineAtServerMs = null;
  return acceptChanged(next, action.nowMs);
}
function confirmScheduled(state, action) {
  if (state.phase !== "countdown") {
    return reject(state, "invalid-phase", "No countdown is active.");
  }
  const next = cloneState(state);
  findPlayer(next, action.actorPlayerId).scheduleStatus = "scheduled";
  return acceptChanged(next, action.nowMs);
}
function cancelCountdown(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "countdown") {
    return reject(state, "invalid-phase", "No countdown is active.");
  }
  const next = cloneState(state);
  resetToReadyCheck(next);
  return acceptChanged(next, action.nowMs);
}
function failCountdown(state, action) {
  if (state.phase !== "countdown") {
    return reject(state, "invalid-phase", "No countdown is active.");
  }
  const next = cloneState(state);
  findPlayer(next, action.actorPlayerId).scheduleStatus = "failed";
  resetToReadyCheck(next);
  return acceptChanged(next, action.nowMs);
}
function reportScore(state, action) {
  if (state.phase !== "playing") {
    return reject(state, "invalid-phase", "Scores are not accepted now.");
  }
  if (action.score.selectionRevision !== state.selectionRevision) {
    return reject(
      state,
      "stale-selection-revision",
      "The score belongs to a different selection."
    );
  }
  const player = findPlayer(state, action.actorPlayerId);
  const selectedChart = selectedChartForPlayer(state, player);
  if (!selectedChart) return reject(state, "chart-not-matched", "The player has no current chart choice.");
  const previous = player.liveScore;
  const maximumScore = selectedChart.tapCount * 1e3;
  if (action.score.score > maximumScore || previous !== null && (action.score.sequence <= previous.sequence || action.score.score < previous.score || action.score.maxCombo < previous.maxCombo)) {
    return reject(
      state,
      "score-regressed",
      "The score snapshot is inconsistent with prior state."
    );
  }
  const next = cloneState(state);
  findPlayer(next, action.actorPlayerId).liveScore = {
    ...action.score
  };
  return acceptChanged(next, action.nowMs);
}
function reportFinished(state, action) {
  const player = findPlayer(state, action.actorPlayerId);
  if (player.finalResult) {
    if (player.finalResult.selectionRevision === action.result.selectionRevision && player.finalResult.sequence === action.result.sequence && player.finalResult.score === action.result.score) {
      return { accepted: true, state };
    }
    return reject(
      state,
      "already-finished",
      "A final result was already submitted."
    );
  }
  if (state.phase !== "playing") {
    return reject(state, "invalid-phase", "Results are not accepted now.");
  }
  if (action.result.selectionRevision !== state.selectionRevision) {
    return reject(
      state,
      "stale-selection-revision",
      "The result belongs to a different selection."
    );
  }
  if (player.liveScore && action.result.score < player.liveScore.score) {
    return reject(
      state,
      "score-regressed",
      "The final result cannot be below the live score."
    );
  }
  const next = cloneState(state);
  const nextPlayer = findPlayer(next, action.actorPlayerId);
  const {
    finishedAtServerMs: _finishedAtServerMs,
    ...liveScore
  } = action.result;
  nextPlayer.liveScore = liveScore;
  nextPlayer.finalResult = { ...action.result };
  next.results.push({
    playerId: action.actorPlayerId,
    result: { ...action.result }
  });
  if (next.resultsDeadlineAtServerMs === null) {
    const selectedChart = selectedChartForPlayer(next, nextPlayer);
    const expectedEnd = next.startSchedule && selectedChart ? next.startSchedule.startAtServerMs + selectedChart.durationSeconds * 1e3 + 5e3 : action.nowMs;
    next.resultsDeadlineAtServerMs = Math.max(
      action.nowMs + 15e3,
      expectedEnd
    );
  }
  const requiredPlayers = next.players.filter(
    (candidate) => candidate.connectionStatus === "connected"
  );
  if (requiredPlayers.length > 0 && requiredPlayers.every((candidate) => candidate.finalResult !== null)) {
    enterResults(next);
  }
  return acceptChanged(next, action.nowMs);
}
function selectedChartForPlayer(state, player) {
  if (state.songPackage && player.chartChoice) {
    return state.songPackage.charts.find((chart) => chart.chartId === player.chartChoice?.chartId && chart.chartHash === player.chartChoice.chartHash) ?? null;
  }
  return state.selection;
}
function replay(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "results") {
    return reject(state, "invalid-phase", "Replay is not available now.");
  }
  if (!state.selection && !state.songPackage) {
    return reject(state, "selection-required", "No chart is selected.");
  }
  const connected = state.players.filter((player) => player.connectionStatus === "connected");
  if (connected.some((player) => !player.replayRequested)) {
    return reject(state, "players-not-ready", "Every connected player must request replay first.");
  }
  const next = cloneState(state);
  next.phase = "ready-check";
  clearGameplayState(next);
  next.players.forEach((player) => {
    player.ready = false;
    player.replayRequested = false;
  });
  return acceptChanged(next, action.nowMs);
}
function voteReplay(state, action) {
  if (state.phase !== "results") return reject(state, "invalid-phase", "Replay voting is available after everyone finishes.");
  const next = cloneState(state);
  findPlayer(next, action.actorPlayerId).replayRequested = action.wantsReplay;
  return acceptChanged(next, action.nowMs);
}
function returnToSelection(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "results") {
    return reject(
      state,
      "invalid-phase",
      "The room is not showing results."
    );
  }
  const next = cloneState(state);
  next.phase = "selecting";
  next.selectionRevision += 1;
  next.selection = null;
  next.songPackage = null;
  next.preview = null;
  next.previewRevision += 1;
  clearGameplayState(next);
  next.players.forEach((player) => {
    player.ready = false;
    player.replayRequested = false;
    player.chartChoice = null;
    player.assetPreparation = null;
  });
  return acceptChanged(next, action.nowMs);
}
function closeByHost(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  const next = cloneState(state);
  closeRoom(next, "host-closed");
  return acceptChanged(next, action.nowMs);
}
function advanceServerTime(state, nowMs) {
  const next = cloneState(state);
  let changed = false;
  const expiredPlayerIds = next.players.filter(
    (player) => player.connectionStatus === "disconnected" && player.disconnectedAtServerMs !== null && nowMs - player.disconnectedAtServerMs > RECONNECT_GRACE_MS
  ).map((player) => player.playerId);
  if (expiredPlayerIds.length > 0) {
    next.players = next.players.filter(
      (player) => !expiredPlayerIds.includes(player.playerId)
    );
    changed = true;
    if (next.players.length === 0) {
      closeRoom(next, "room-empty");
    } else if (expiredPlayerIds.includes(next.hostPlayerId)) {
      transferHost(next);
    }
    updateDisplayLabels(next.players);
  }
  if (next.phase === "countdown" && next.startSchedule && nowMs >= next.startSchedule.startAtServerMs) {
    if (next.players.every(
      (player) => player.connectionStatus === "connected" && player.scheduleStatus === "scheduled"
    )) {
      next.phase = "playing";
    } else {
      resetToReadyCheck(next);
    }
    changed = true;
  }
  if (next.phase === "playing" && next.resultsDeadlineAtServerMs !== null && nowMs >= next.resultsDeadlineAtServerMs) {
    enterResults(next);
    changed = true;
  }
  if ((next.phase === "selecting" || next.phase === "ready-check") && nowMs >= next.expiresAtServerMs) {
    closeRoom(next, "room-expired");
    changed = true;
  }
  return changed ? acceptChanged(next, nowMs, false) : { accepted: true, state };
}
function createPlayer(playerId, displayName, nowMs) {
  const normalizedName = displayName.trim();
  return {
    playerId,
    displayName: normalizedName,
    displayLabel: normalizedName,
    joinedAtServerMs: nowMs,
    connectionStatus: "connected",
    disconnectedAtServerMs: null,
    availability: createUncheckedAvailability(),
    ready: false,
    clockQuality: "unknown",
    scheduleStatus: "not-scheduled",
    liveScore: null,
    finalResult: null,
    replayRequested: false,
    winCount: 0,
    chartChoice: null,
    assetPreparation: null
  };
}
function createUncheckedAvailability() {
  return {
    status: "unchecked",
    selectionRevision: null,
    chartHash: null,
    audioReady: false
  };
}
function enterResults(state) {
  if (state.phase === "results") return;
  const completed = state.players.filter(
    (player) => player.finalResult !== null
  );
  const highestScore = completed.reduce(
    (highest, player) => Math.max(highest, player.finalResult.score),
    -1
  );
  if (highestScore >= 0) {
    completed.forEach((player) => {
      if (player.finalResult.score === highestScore) {
        player.winCount += 1;
      }
    });
  }
  state.phase = "results";
}
function resetPlayersForSelection(players) {
  players.forEach((player) => {
    player.availability = createUncheckedAvailability();
    player.ready = false;
    player.scheduleStatus = "not-scheduled";
    player.liveScore = null;
    player.finalResult = null;
    player.replayRequested = false;
    player.chartChoice = null;
    player.assetPreparation = null;
  });
}
function clearGameplayState(state) {
  state.startSchedule = null;
  state.results = [];
  state.resultsDeadlineAtServerMs = null;
  state.players.forEach((player) => {
    player.scheduleStatus = "not-scheduled";
    player.liveScore = null;
    player.finalResult = null;
  });
}
function resetToReadyCheck(state) {
  state.phase = "ready-check";
  state.startSchedule = null;
  state.resultsDeadlineAtServerMs = null;
  state.players.forEach((player) => {
    player.ready = false;
    player.scheduleStatus = "not-scheduled";
  });
}
function closeRoom(state, reason) {
  state.phase = "closed";
  state.closeReason = reason;
  state.startSchedule = null;
}
function transferHost(state) {
  const nextHost = state.players.filter((player) => player.connectionStatus === "connected").sort(
    (left, right) => left.joinedAtServerMs - right.joinedAtServerMs
  )[0];
  if (nextHost) {
    state.hostPlayerId = nextHost.playerId;
  } else {
    closeRoom(state, "room-empty");
  }
}
function updateDisplayLabels(players) {
  const counts = /* @__PURE__ */ new Map();
  players.sort(
    (left, right) => left.joinedAtServerMs - right.joinedAtServerMs
  ).forEach((player) => {
    const count = (counts.get(player.displayName) ?? 0) + 1;
    counts.set(player.displayName, count);
    player.displayLabel = count === 1 ? player.displayName : `${player.displayName} (${count})`;
  });
}
function hasMatchingChart(player, state) {
  if (state.songPackage) {
    return Boolean(
      player.chartChoice?.selectionRevision === state.selectionRevision && player.assetPreparation?.selectionRevision === state.selectionRevision && player.assetPreparation.status === "prepared" && player.assetPreparation.verifiedAudioHash === state.songPackage.audio.sha256
    );
  }
  return Boolean(state.selection && player.availability.status === "matching-chart" && player.availability.selectionRevision === state.selectionRevision && player.availability.chartHash === state.selection.chartHash);
}
function requireHost(state, playerId) {
  return state.hostPlayerId === playerId ? null : reject(state, "not-host", "Only the host can do that.");
}
function findPlayer(state, playerId) {
  return state.players.find((player) => player.playerId === playerId);
}
function isActorAction(action) {
  return "actorPlayerId" in action;
}
function cloneState(state) {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      availability: { ...player.availability },
      liveScore: player.liveScore ? { ...player.liveScore } : null,
      finalResult: player.finalResult ? { ...player.finalResult } : null
    })),
    selection: state.selection ? { ...state.selection } : null,
    startSchedule: state.startSchedule ? { ...state.startSchedule } : null,
    results: state.results.map((entry) => ({
      playerId: entry.playerId,
      result: { ...entry.result }
    }))
  };
}
function acceptChanged(state, nowMs, refreshExpiry = true) {
  state.revision += 1;
  state.lastActivityAtServerMs = nowMs;
  if (refreshExpiry) {
    state.expiresAtServerMs = nowMs + ROOM_INACTIVITY_MS;
  }
  return { accepted: true, state };
}
function reject(state, code, message) {
  return {
    accepted: false,
    state,
    code,
    message
  };
}

// server/roomRegistry.ts
var ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var RoomRegistry = class {
  rooms = /* @__PURE__ */ new Map();
  roomIdsByCode = /* @__PURE__ */ new Map();
  memberships = /* @__PURE__ */ new Map();
  now;
  createRoomId;
  createPlayerId;
  createReconnectToken;
  createRoomCode;
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.createRoomId = options.createRoomId ?? randomUUID2;
    this.createPlayerId = options.createPlayerId ?? randomUUID2;
    this.createReconnectToken = options.createReconnectToken ?? (() => randomBytes2(32).toString("hex"));
    this.createRoomCode = options.createRoomCode ?? createRandomRoomCode;
  }
  getRoomCount() {
    return this.rooms.size;
  }
  getRoomState(roomId) {
    return this.rooms.get(roomId)?.state ?? null;
  }
  getMembership(socketId) {
    return this.memberships.get(socketId) ?? null;
  }
  getMemberContext(socketId, roomId) {
    const membership = this.memberships.get(socketId);
    const record = this.rooms.get(roomId);
    if (!membership || membership.roomId !== roomId || !record) {
      return null;
    }
    return {
      ...membership,
      roomRevision: record.state.revision,
      isHost: record.state.hostPlayerId === membership.playerId
    };
  }
  createRoom(socketId, command2) {
    if (this.memberships.has(socketId)) {
      return this.rejection(
        command2.commandId,
        "invalid-command",
        "Leave the current room before creating another.",
        null
      );
    }
    const roomId = this.createRoomId();
    const playerId = this.createPlayerId();
    const reconnectToken = this.createReconnectToken();
    const roomCode = this.generateUniqueRoomCode();
    const nowMs = this.now();
    const state = createRoomState({
      roomId,
      roomCode,
      hostPlayerId: playerId,
      hostDisplayName: command2.payload.displayName,
      nowMs
    });
    this.rooms.set(roomId, {
      state,
      reconnectTokens: /* @__PURE__ */ new Map([
        [playerId, reconnectToken]
      ])
    });
    this.roomIdsByCode.set(roomCode, roomId);
    this.memberships.set(socketId, { roomId, playerId });
    return {
      response: {
        protocolVersion: PROTOCOL_VERSION,
        type: "room.created",
        room: state,
        credentials: {
          roomId,
          playerId,
          reconnectToken
        }
      },
      effects: [],
      joinedRoomId: roomId
    };
  }
  joinRoom(socketId, command2) {
    if (this.memberships.has(socketId)) {
      return this.rejection(
        command2.commandId,
        "invalid-command",
        "Leave the current room before joining another.",
        null
      );
    }
    const roomId = this.roomIdsByCode.get(
      command2.payload.roomCode
    );
    const record = roomId ? this.rooms.get(roomId) : void 0;
    if (!roomId || !record) {
      return this.rejection(
        command2.commandId,
        "room-not-found",
        "That room code is invalid or expired.",
        null
      );
    }
    const playerId = this.createPlayerId();
    const reconnectToken = this.createReconnectToken();
    const transition = transitionRoom(record.state, {
      type: "player.join",
      playerId,
      displayName: command2.payload.displayName,
      nowMs: this.now()
    });
    if (!transition.accepted) {
      return this.transitionRejection(
        command2.commandId,
        transition
      );
    }
    record.state = transition.state;
    record.reconnectTokens.set(playerId, reconnectToken);
    this.memberships.set(socketId, { roomId, playerId });
    return {
      response: {
        protocolVersion: PROTOCOL_VERSION,
        type: "room.joined",
        room: record.state,
        credentials: {
          roomId,
          playerId,
          reconnectToken
        }
      },
      effects: [this.snapshotEffect(record.state)],
      joinedRoomId: roomId
    };
  }
  resumeRoom(socketId, command2) {
    if (this.memberships.has(socketId)) {
      return this.rejection(
        command2.commandId,
        "invalid-command",
        "This connection already belongs to a room.",
        null
      );
    }
    const record = this.rooms.get(command2.payload.roomId);
    if (!record) {
      return this.rejection(
        command2.commandId,
        "room-not-found",
        "The room no longer exists.",
        null
      );
    }
    const expectedToken = record.reconnectTokens.get(
      command2.payload.playerId
    );
    if (!expectedToken || expectedToken !== command2.payload.reconnectToken) {
      return this.rejection(
        command2.commandId,
        "reconnect-token-invalid",
        "The reconnect credentials are invalid.",
        record.state.revision
      );
    }
    const player = record.state.players.find(
      (candidate) => candidate.playerId === command2.payload.playerId
    );
    if (!player) {
      return this.rejection(
        command2.commandId,
        "reconnect-grace-expired",
        "The reconnect window has expired.",
        record.state.revision
      );
    }
    if (player.connectionStatus === "connected") {
      return this.rejection(
        command2.commandId,
        "invalid-command",
        "That player is already connected.",
        record.state.revision
      );
    }
    const transition = transitionRoom(record.state, {
      type: "player.resume",
      playerId: command2.payload.playerId,
      nowMs: this.now()
    });
    if (!transition.accepted) {
      return this.transitionRejection(
        command2.commandId,
        transition
      );
    }
    record.state = transition.state;
    this.memberships.set(socketId, {
      roomId: command2.payload.roomId,
      playerId: command2.payload.playerId
    });
    return {
      response: {
        protocolVersion: PROTOCOL_VERSION,
        type: "room.resumed",
        room: record.state,
        credentials: {
          roomId: command2.payload.roomId,
          playerId: command2.payload.playerId,
          reconnectToken: command2.payload.reconnectToken
        }
      },
      effects: [this.snapshotEffect(record.state)],
      joinedRoomId: command2.payload.roomId
    };
  }
  handleMemberCommand(socketId, command2) {
    const membership = this.memberships.get(socketId);
    if (!membership || membership.roomId !== command2.roomId) {
      return this.rejection(
        command2.commandId,
        "not-a-member",
        "This connection is not a member of that room.",
        null
      );
    }
    const record = this.rooms.get(membership.roomId);
    if (!record) {
      this.memberships.delete(socketId);
      return this.rejection(
        command2.commandId,
        "room-not-found",
        "The room no longer exists.",
        null
      );
    }
    const action = this.toRoomAction(
      command2,
      membership.playerId,
      record.state
    );
    const transition = transitionRoom(record.state, action);
    if (!transition.accepted) {
      return this.transitionRejection(
        command2.commandId,
        transition
      );
    }
    record.state = transition.state;
    const effects = [];
    const result = {
      response: {
        protocolVersion: PROTOCOL_VERSION,
        type: "command.accepted",
        commandId: command2.commandId,
        roomRevision: transition.state.revision,
        room: transition.state
      },
      effects
    };
    if (command2.type === "player.kick") {
      const kickedMembership = [...this.memberships.entries()].find(
        ([, candidate]) => candidate.roomId === membership.roomId && candidate.playerId === command2.payload.playerId
      );
      if (kickedMembership) {
        result.kickedSocketId = kickedMembership[0];
        result.kickedPlayerId = command2.payload.playerId;
        result.kickedRoomId = membership.roomId;
        this.memberships.delete(kickedMembership[0]);
      }
      record.reconnectTokens.delete(command2.payload.playerId);
    }
    if (command2.type === "room.leave") {
      record.reconnectTokens.delete(membership.playerId);
      this.memberships.delete(socketId);
      result.leftRoomId = membership.roomId;
    }
    if (transition.state.phase === "closed") {
      effects.push(this.closedEffect(transition.state));
      this.deleteRoom(membership.roomId);
    } else {
      effects.push(this.snapshotEffect(transition.state));
    }
    return result;
  }
  handleClockPing(socketId, command2, receivedAtMs) {
    const membership = this.memberships.get(socketId);
    if (!membership || membership.roomId !== command2.roomId) {
      return this.rejection(
        command2.commandId,
        "not-a-member",
        "Join the room before synchronizing clocks.",
        null
      );
    }
    return {
      response: {
        protocolVersion: PROTOCOL_VERSION,
        type: "clock.pong",
        clientSentAtPerformanceMs: command2.payload.clientSentAtPerformanceMs,
        serverReceivedAtMs: receivedAtMs,
        serverSentAtMs: this.now()
      },
      effects: []
    };
  }
  disconnect(socketId) {
    const membership = this.memberships.get(socketId);
    this.memberships.delete(socketId);
    if (!membership) {
      return [];
    }
    const record = this.rooms.get(membership.roomId);
    if (!record) {
      return [];
    }
    const transition = transitionRoom(record.state, {
      type: "player.disconnect",
      playerId: membership.playerId,
      nowMs: this.now()
    });
    if (!transition.accepted) {
      return [];
    }
    record.state = transition.state;
    return [this.snapshotEffect(record.state)];
  }
  tick() {
    const effects = [];
    const nowMs = this.now();
    for (const [roomId, record] of this.rooms) {
      const transition = transitionRoom(record.state, {
        type: "server.tick",
        nowMs
      });
      if (!transition.accepted || transition.state === record.state) {
        continue;
      }
      record.state = transition.state;
      if (record.state.phase === "closed") {
        effects.push(this.closedEffect(record.state));
        this.deleteRoom(roomId);
      } else {
        effects.push(this.snapshotEffect(record.state));
      }
    }
    return effects;
  }
  toRoomAction(command2, actorPlayerId, state) {
    const nowMs = this.now();
    const expectedRoomRevision = "expectedRoomRevision" in command2 ? command2.expectedRoomRevision : state.revision;
    const base = {
      actorPlayerId,
      expectedRoomRevision,
      nowMs
    };
    switch (command2.type) {
      case "room.leave":
        return { type: "player.leave", ...base };
      case "room.close":
        return { type: "room.close", ...base };
      case "player.rename":
        return {
          type: "player.rename",
          displayName: command2.payload.displayName,
          ...base
        };
      case "player.availability":
        return {
          type: "player.availability",
          availability: command2.payload.availability,
          ...base
        };
      case "player.ready":
        return {
          type: "player.ready",
          ready: command2.payload.ready,
          ...base
        };
      case "player.clockQuality":
        return { type: "player.clockQuality", usable: command2.payload.usable, ...base };
      case "player.kick":
        return { type: "player.kick", playerId: command2.payload.playerId, ...base };
      case "selection.set":
        return {
          type: "selection.set",
          selection: command2.payload.selection,
          ...base
        };
      case "selection.clear":
        return { type: "selection.clear", ...base };
      case "preview.publish":
        return {
          type: "preview.publish",
          preview: command2.payload.preview,
          ...base
        };
      case "preview.clear":
        return { type: "preview.clear", ...base };
      case "songPackage.commit":
        return { type: "songPackage.commit", songPackage: command2.payload.songPackage, ...base };
      case "player.chart.select":
        return { type: "player.chart.select", choice: command2.payload.choice, ...base };
      case "player.asset.status":
        return { type: "player.asset.status", preparation: command2.payload.preparation, ...base };
      case "readyCheck.begin":
        return { type: "readyCheck.begin", ...base };
      case "readyCheck.cancel":
        return { type: "readyCheck.cancel", ...base };
      case "countdown.request":
        return { type: "countdown.request", ...base };
      case "countdown.cancel":
        return { type: "countdown.cancel", ...base };
      case "countdown.scheduled":
        return { type: "countdown.scheduled", ...base };
      case "countdown.failed":
        return { type: "countdown.failed", ...base };
      case "game.score":
        return {
          type: "game.score",
          score: command2.payload.score,
          ...base
        };
      case "game.finished":
        return {
          type: "game.finished",
          result: command2.payload.result,
          ...base
        };
      case "results.replay":
        return { type: "results.replay", ...base };
      case "results.replayVote":
        return { type: "results.replayVote", wantsReplay: command2.payload.wantsReplay, ...base };
      case "results.returnToSelection":
        return {
          type: "results.returnToSelection",
          ...base
        };
    }
  }
  generateUniqueRoomCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = this.createRoomCode().toUpperCase();
      if (/^[A-HJ-NP-Z2-9]{6}$/.test(code) && !this.roomIdsByCode.has(code)) {
        return code;
      }
    }
    throw new Error("Could not allocate a unique room code.");
  }
  snapshotEffect(state) {
    return {
      roomId: state.roomId,
      closeRoom: false,
      message: {
        protocolVersion: PROTOCOL_VERSION,
        type: "room.snapshot",
        room: state
      }
    };
  }
  closedEffect(state) {
    return {
      roomId: state.roomId,
      closeRoom: true,
      message: {
        protocolVersion: PROTOCOL_VERSION,
        type: "room.closed",
        roomId: state.roomId,
        reason: state.closeReason ?? "room-empty",
        message: this.closeMessage(state.closeReason)
      }
    };
  }
  closeMessage(reason) {
    switch (reason) {
      case "host-closed":
        return "The host closed the room.";
      case "room-expired":
        return "The room expired due to inactivity.";
      case "room-empty":
      case null:
        return "The room is empty.";
      case "kicked":
        return "The host removed you from the room.";
    }
  }
  transitionRejection(commandId, transition) {
    return this.rejection(
      commandId,
      transition.code,
      transition.message,
      transition.state.revision
    );
  }
  rejection(commandId, code, message, roomRevision) {
    return {
      response: {
        protocolVersion: PROTOCOL_VERSION,
        type: "command.rejected",
        commandId,
        code,
        message,
        roomRevision
      },
      effects: []
    };
  }
  deleteRoom(roomId) {
    const record = this.rooms.get(roomId);
    if (record) {
      this.roomIdsByCode.delete(record.state.roomCode);
    }
    this.rooms.delete(roomId);
    for (const [socketId, membership] of this.memberships) {
      if (membership.roomId === roomId) {
        this.memberships.delete(socketId);
      }
    }
  }
};
function createRandomRoomCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

// server/createDanceVisionServer.ts
import { createReadStream as createReadStream2 } from "fs";
import { stat as stat2 } from "fs/promises";
import {
  extname,
  resolve,
  sep
} from "path";
var DanceVisionServer = class {
  port;
  host;
  tickIntervalMs;
  registry;
  assetRelay;
  allowedOrigins;
  httpServer;
  io;
  staticRoot;
  tickTimer = null;
  relayCleanupTimer = null;
  constructor(options = {}) {
    this.port = options.port ?? 3001;
    this.host = options.host ?? "127.0.0.1";
    this.tickIntervalMs = options.tickIntervalMs ?? 250;
    this.registry = new RoomRegistry(options.registryOptions);
    this.assetRelay = new AssetRelayService(options.assetRelayOptions);
    this.staticRoot = resolve(process.cwd(), "dist");
    this.allowedOrigins = options.allowedOrigins ?? [
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ];
    this.httpServer = createHttpServer((request, response) => {
      void this.handleHttpRequest(request, response);
    });
    this.io = new SocketIoServer(this.httpServer, {
      cors: {
        origin: this.allowedOrigins,
        methods: ["GET", "POST"]
      }
    });
    this.io.on("connection", (socket) => {
      this.configureSocket(socket);
    });
  }
  async handleHttpRequest(request, response) {
    const origin = request.headers.origin;
    if (origin && this.allowedOrigins.includes(origin)) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
      response.setHeader(
        "access-control-allow-headers",
        "Authorization, Content-Type, Content-Length, Range"
      );
      response.setHeader(
        "access-control-expose-headers",
        "Content-Length, Content-Range, Accept-Ranges"
      );
    }
    if (request.method === "OPTIONS" && request.url?.startsWith("/relay/assets/")) {
      response.writeHead(204, {
        "access-control-allow-methods": "PUT, GET, OPTIONS",
        "cache-control": "no-store"
      });
      response.end();
      return;
    }
    if (await this.assetRelay.handleHttp(request, response)) {
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(JSON.stringify({
        status: "ok",
        protocolVersion: PROTOCOL_VERSION,
        rooms: this.registry.getRoomCount()
      }));
      return;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (await this.handleStaticRequest(request, response)) {
        return;
      }
    }
    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify({
      error: "not-found"
    }));
  }
  async handleStaticRequest(request, response) {
    const requestUrl = request.url ?? "/";
    if (requestUrl.startsWith("/socket.io/")) {
      return false;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(requestUrl, "http://localhost").pathname
      );
    } catch {
      return false;
    }
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const requestedPath = resolve(
      this.staticRoot,
      relativePath
    );
    if (requestedPath !== this.staticRoot && !requestedPath.startsWith(
      `${this.staticRoot}${sep}`
    )) {
      return false;
    }
    const staticRootPrefix = `${this.staticRoot}${sep}`;
    if (requestedPath !== this.staticRoot && !requestedPath.startsWith(staticRootPrefix)) {
      return false;
    }
    if (await this.tryServeFile(
      requestedPath,
      request.method === "HEAD",
      response
    )) {
      return true;
    }
    const indexPath = resolve(
      this.staticRoot,
      "index.html"
    );
    return this.tryServeFile(
      indexPath,
      request.method === "HEAD",
      response
    );
  }
  async tryServeFile(filePath, headOnly, response) {
    let fileStats;
    try {
      fileStats = await stat2(filePath);
    } catch {
      return false;
    }
    if (!fileStats.isFile()) {
      return false;
    }
    const isViteAsset = filePath.startsWith(
      `${resolve(this.staticRoot, "assets")}${sep}`
    );
    response.writeHead(200, {
      "content-type": this.contentTypeFor(filePath),
      "content-length": fileStats.size,
      "cache-control": isViteAsset ? "public, max-age=31536000, immutable" : "no-cache"
    });
    if (headOnly) {
      response.end();
      return true;
    }
    const stream = createReadStream2(filePath);
    stream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end();
    });
    stream.pipe(response);
    return true;
  }
  contentTypeFor(filePath) {
    switch (extname(filePath).toLowerCase()) {
      case ".html":
        return "text/html; charset=utf-8";
      case ".js":
        return "text/javascript; charset=utf-8";
      case ".css":
        return "text/css; charset=utf-8";
      case ".json":
        return "application/json; charset=utf-8";
      case ".svg":
        return "image/svg+xml";
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".webp":
        return "image/webp";
      case ".ico":
        return "image/x-icon";
      case ".woff":
        return "font/woff";
      case ".woff2":
        return "font/woff2";
      case ".wasm":
        return "application/wasm";
      case ".mp3":
        return "audio/mpeg";
      case ".ogg":
        return "audio/ogg";
      case ".wav":
        return "audio/wav";
      default:
        return "application/octet-stream";
    }
  }
  referencedAssetIds(room) {
    const assetIds = /* @__PURE__ */ new Set();
    if (!room) {
      return assetIds;
    }
    if (room.preview?.artwork) {
      assetIds.add(room.preview.artwork.assetId);
    }
    if (room.preview?.audioPreview) {
      assetIds.add(room.preview.audioPreview.assetId);
    }
    if (room.songPackage?.artwork) {
      assetIds.add(room.songPackage.artwork.assetId);
    }
    if (room.songPackage) {
      assetIds.add(room.songPackage.audio.assetId);
      assetIds.add(room.songPackage.chartPackage.assetId);
    }
    return assetIds;
  }
  async start() {
    if (this.httpServer.listening) {
      return this.getUrl();
    }
    await this.assetRelay.start();
    await new Promise((resolve2, reject2) => {
      const handleError = (error) => {
        this.httpServer.off("listening", handleListening);
        reject2(error);
      };
      const handleListening = () => {
        this.httpServer.off("error", handleError);
        resolve2();
      };
      this.httpServer.once("error", handleError);
      this.httpServer.once("listening", handleListening);
      this.httpServer.listen(this.port, this.host);
    });
    this.tickTimer = setInterval(() => {
      this.publishEffects(this.registry.tick());
    }, this.tickIntervalMs);
    this.tickTimer.unref?.();
    this.relayCleanupTimer = setInterval(() => {
      void this.assetRelay.cleanupExpired();
    }, 3e4);
    this.relayCleanupTimer.unref?.();
    return this.getUrl();
  }
  async stop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.relayCleanupTimer) {
      clearInterval(this.relayCleanupTimer);
      this.relayCleanupTimer = null;
    }
    await new Promise((resolve2) => {
      this.io.close(() => resolve2());
    });
  }
  getRoomCount() {
    return this.registry.getRoomCount();
  }
  configureSocket(socket) {
    socket.on("command", (rawCommand, acknowledge) => {
      if (typeof acknowledge !== "function") {
        return;
      }
      void this.handleCommand(
        socket,
        rawCommand,
        acknowledge
      ).catch(() => {
        acknowledge({
          protocolVersion: PROTOCOL_VERSION,
          type: "server.error",
          code: "internal-server-error",
          message: "The server could not process the command."
        });
      });
    });
    socket.on("disconnect", () => {
      this.publishEffects(
        this.registry.disconnect(socket.id)
      );
    });
  }
  async handleCommand(socket, rawCommand, acknowledge) {
    const receivedAtMs = Date.now();
    const parsed = clientCommandSchema.safeParse(rawCommand);
    if (!parsed.success) {
      acknowledge(this.invalidCommandResponse(rawCommand));
      return;
    }
    const command2 = parsed.data;
    let result;
    switch (command2.type) {
      case "room.create":
        result = this.registry.createRoom(socket.id, command2);
        break;
      case "room.join":
        result = this.registry.joinRoom(socket.id, command2);
        break;
      case "room.resume":
        result = this.registry.resumeRoom(socket.id, command2);
        break;
      case "clock.ping":
        result = this.registry.handleClockPing(
          socket.id,
          command2,
          receivedAtMs
        );
        break;
      case "asset.upload.request":
      case "asset.download.request":
        acknowledge(this.handleAssetCommand(socket, command2));
        return;
      default:
        if (command2.type === "preview.publish") {
          const rejection = this.validatePreviewAssets(socket, command2);
          if (rejection) {
            acknowledge(rejection);
            return;
          }
        }
        if (command2.type === "songPackage.commit") {
          const rejection = this.validateSongPackageAssets(socket, command2);
          if (rejection) {
            acknowledge(rejection);
            return;
          }
        }
        const previousRoom = this.registry.getRoomState(
          command2.roomId
        );
        const previousAssetIds = this.referencedAssetIds(previousRoom);
        result = this.registry.handleMemberCommand(
          socket.id,
          command2
        );
        if (result.response.type === "command.accepted") {
          const currentRoom = this.registry.getRoomState(
            command2.roomId
          );
          const currentAssetIds = this.referencedAssetIds(currentRoom);
          for (const assetId of previousAssetIds) {
            if (!currentAssetIds.has(assetId)) {
              void this.assetRelay.deleteAsset(
                command2.roomId,
                assetId
              );
            }
          }
        }
        break;
    }
    if (result.joinedRoomId) {
      await socket.join(result.joinedRoomId);
    }
    if (result.leftRoomId) {
      await socket.leave(result.leftRoomId);
    }
    if (result.kickedSocketId && result.kickedRoomId) {
      const kickedSocket = this.io.sockets.sockets.get(result.kickedSocketId);
      if (kickedSocket) {
        kickedSocket.emit("message", {
          protocolVersion: PROTOCOL_VERSION,
          type: "room.closed",
          roomId: result.kickedRoomId,
          reason: "kicked",
          message: "The host removed you from the room."
        });
        await kickedSocket.leave(result.kickedRoomId);
      }
    }
    acknowledge(result.response);
    this.publishEffects(result.effects);
  }
  validatePreviewAssets(socket, command2) {
    const context = this.registry.getMemberContext(socket.id, command2.roomId);
    if (!context) {
      return this.assetRejection(command2.commandId, "not-a-member", "Join the room before publishing a preview.", null);
    }
    if (!context.isHost) {
      return this.assetRejection(command2.commandId, "not-host", "Only the host can publish song previews.", context.roomRevision);
    }
    const assets = [command2.payload.preview.artwork, command2.payload.preview.audioPreview].filter((asset) => asset !== null);
    const allReady = assets.every((asset) => {
      const ready = this.assetRelay.getReadyAsset(command2.roomId, asset.assetId);
      return ready !== null && JSON.stringify(ready) === JSON.stringify(asset);
    });
    return allReady ? null : this.assetRejection(
      command2.commandId,
      "asset-not-ready",
      "Every preview asset must be fully uploaded to this room before publication.",
      context.roomRevision
    );
  }
  validateSongPackageAssets(socket, command2) {
    const context = this.registry.getMemberContext(socket.id, command2.roomId);
    if (!context) return this.assetRejection(command2.commandId, "not-a-member", "Join the room before confirming a song.", null);
    if (!context.isHost) return this.assetRejection(command2.commandId, "not-host", "Only the host can confirm the room song.", context.roomRevision);
    const descriptors = [
      command2.payload.songPackage.audio,
      command2.payload.songPackage.chartPackage,
      ...command2.payload.songPackage.artwork ? [command2.payload.songPackage.artwork] : []
    ];
    const allReady = descriptors.every((asset) => {
      const ready = this.assetRelay.getReadyAsset(command2.roomId, asset.assetId);
      return ready !== null && JSON.stringify(ready) === JSON.stringify(asset);
    });
    return allReady ? null : this.assetRejection(
      command2.commandId,
      "asset-not-ready",
      "The song audio, charts, and artwork must finish uploading before confirmation.",
      context.roomRevision
    );
  }
  handleAssetCommand(socket, command2) {
    const context = this.registry.getMemberContext(
      socket.id,
      command2.roomId
    );
    if (!context) {
      return this.assetRejection(
        command2.commandId,
        "not-a-member",
        "Join the room before requesting asset transfer.",
        null
      );
    }
    if (command2.type === "asset.upload.request" && !context.isHost) {
      return this.assetRejection(
        command2.commandId,
        "not-host",
        "Only the room host can upload song assets.",
        context.roomRevision
      );
    }
    try {
      if (command2.type === "asset.upload.request") {
        const grant2 = this.assetRelay.reserveUpload(
          context.roomId,
          context.playerId,
          command2.payload.asset
        );
        return {
          protocolVersion: PROTOCOL_VERSION,
          type: "asset.upload.granted",
          commandId: command2.commandId,
          ...grant2
        };
      }
      const grant = this.assetRelay.grantDownload(
        context.roomId,
        context.playerId,
        command2.payload.assetId
      );
      return {
        protocolVersion: PROTOCOL_VERSION,
        type: "asset.download.granted",
        commandId: command2.commandId,
        ...grant
      };
    } catch (error) {
      const relayError = error instanceof AssetRelayError ? error : new AssetRelayError(
        "invalid-payload",
        "The asset request is invalid.",
        400
      );
      return this.assetRejection(
        command2.commandId,
        relayError.code,
        relayError.message,
        context.roomRevision
      );
    }
  }
  assetRejection(commandId, code, message, roomRevision) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      type: "command.rejected",
      commandId,
      code,
      message,
      roomRevision
    };
  }
  invalidCommandResponse(rawCommand) {
    const record = this.asRecord(rawCommand);
    const protocolVersion = record?.protocolVersion;
    const commandId = typeof record?.commandId === "string" && record.commandId.length > 0 ? record.commandId : "unknown-command";
    return {
      protocolVersion: PROTOCOL_VERSION,
      type: "command.rejected",
      commandId,
      code: protocolVersion !== void 0 && protocolVersion !== PROTOCOL_VERSION ? "protocol-version-mismatch" : "invalid-payload",
      message: protocolVersion !== void 0 && protocolVersion !== PROTOCOL_VERSION ? "The client protocol version is unsupported." : "The command payload is invalid.",
      roomRevision: null
    };
  }
  publishEffects(effects) {
    for (const effect of effects) {
      this.io.to(effect.roomId).emit(
        "message",
        effect.message
      );
      if (effect.closeRoom) {
        this.io.in(effect.roomId).socketsLeave(effect.roomId);
        void this.assetRelay.deleteRoom(effect.roomId);
      }
    }
  }
  getUrl() {
    const address = this.httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("The room server is not listening.");
    }
    return `http://${this.host}:${address.port}`;
  }
  asRecord(value) {
    return typeof value === "object" && value !== null ? value : null;
  }
};

// server/config.ts
var DEFAULT_RELAY_ASSET_TTL_MINUTES = 30;
var DEFAULT_HOST = process.env.DYNO ? "0.0.0.0" : "127.0.0.1";
var DEFAULT_PORT = 3001;
var DEFAULT_RELAY_ROOM_QUOTA_MB = 200;
function loadServerConfig(environment = process.env) {
  const parsedPort = Number.parseInt(
    environment.PORT ?? "",
    10
  );
  const parsedAssetTtlMinutes = Number.parseInt(
    environment.RELAY_ASSET_TTL_MINUTES ?? "",
    10
  );
  const allowedOrigins = (environment.CLIENT_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((origin) => origin.trim()).filter(Boolean);
  const parsedQuotaMb = Number.parseInt(
    environment.RELAY_ROOM_QUOTA_MB ?? "",
    10
  );
  return {
    host: environment.HOST?.trim() || DEFAULT_HOST,
    port: Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT,
    allowedOrigins,
    relayTempDirectory: environment.RELAY_TEMP_DIR?.trim() || void 0,
    relayRoomQuotaBytes: (Number.isInteger(parsedQuotaMb) && parsedQuotaMb > 0 ? parsedQuotaMb : DEFAULT_RELAY_ROOM_QUOTA_MB) * 1024 * 1024,
    relayAssetTtlMs: (Number.isInteger(parsedAssetTtlMinutes) && parsedAssetTtlMinutes > 0 ? parsedAssetTtlMinutes : DEFAULT_RELAY_ASSET_TTL_MINUTES) * 60 * 1e3
  };
}

// server/index.ts
var config = loadServerConfig();
var server = new DanceVisionServer({
  port: config.port,
  host: config.host,
  allowedOrigins: config.allowedOrigins,
  assetRelayOptions: {
    rootDirectory: config.relayTempDirectory,
    roomQuotaBytes: config.relayRoomQuotaBytes,
    assetTtlMs: config.relayAssetTtlMs
  }
});
var url = await server.start();
console.log(`Dance Vision room server listening at ${url}`);
var stopping = false;
async function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  await server.stop();
}
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
