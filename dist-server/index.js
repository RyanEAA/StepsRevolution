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
import { z } from "zod";
var identifierSchema = z.string().trim().min(1).max(128);
var revisionSchema = z.number().int().nonnegative();
var timestampSchema = z.number().finite().nonnegative();
var roomPhaseSchema = z.enum([
  "selecting",
  "ready-check",
  "countdown",
  "playing",
  "results",
  "closed"
]);
var connectionStatusSchema = z.enum([
  "connected",
  "disconnected"
]);
var availabilityStatusSchema = z.enum([
  "unchecked",
  "checking",
  "matching-chart",
  "song-missing",
  "chart-missing",
  "chart-mismatch",
  "error"
]);
var clockQualitySchema = z.enum([
  "unknown",
  "usable",
  "unusable"
]);
var scheduleStatusSchema = z.enum([
  "not-scheduled",
  "scheduled",
  "failed"
]);
var roomSelectionSchema = z.object({
  selectionRevision: revisionSchema.positive(),
  songId: identifierSchema,
  chartId: identifierSchema,
  chartHash: z.string().regex(
    new RegExp(
      `^${CHART_IDENTITY_VERSION}:[a-f0-9]{64}$`
    )
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
  selectedAtServerMs: timestampSchema
}).strict();
var availabilitySchema = z.object({
  status: availabilityStatusSchema,
  selectionRevision: revisionSchema.nullable(),
  chartHash: z.string().nullable(),
  audioReady: z.boolean()
}).strict();
var liveScoreSchema = z.object({
  selectionRevision: revisionSchema.positive(),
  sequence: z.number().int().nonnegative(),
  score: z.number().int().nonnegative(),
  combo: z.number().int().nonnegative(),
  maxCombo: z.number().int().nonnegative(),
  perfectCount: z.number().int().nonnegative(),
  greatCount: z.number().int().nonnegative(),
  goodCount: z.number().int().nonnegative(),
  missCount: z.number().int().nonnegative(),
  gameTimeSeconds: z.number().finite().nonnegative()
}).strict();
var finalResultSchema = liveScoreSchema.extend({
  finishedAtServerMs: timestampSchema
}).strict();
var roomResultSchema = z.object({
  playerId: identifierSchema,
  result: finalResultSchema
}).strict();
var startScheduleSchema = z.object({
  selectionRevision: revisionSchema.positive(),
  startAtServerMs: timestampSchema,
  issuedAtServerMs: timestampSchema
}).strict();
var roomPlayerSchema = z.object({
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
  finalResult: finalResultSchema.nullable()
}).strict();
var closeReasonSchema = z.enum([
  "host-closed",
  "room-empty",
  "room-expired"
]);
var roomStateSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: identifierSchema,
  roomCode: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/),
  revision: revisionSchema,
  selectionRevision: revisionSchema,
  phase: roomPhaseSchema,
  hostPlayerId: identifierSchema,
  players: z.array(roomPlayerSchema),
  selection: roomSelectionSchema.nullable(),
  startSchedule: startScheduleSchema.nullable(),
  results: z.array(roomResultSchema),
  resultsDeadlineAtServerMs: timestampSchema.nullable(),
  createdAtServerMs: timestampSchema,
  lastActivityAtServerMs: timestampSchema,
  expiresAtServerMs: timestampSchema,
  closeReason: closeReasonSchema.nullable()
}).strict();
var commandBase = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: identifierSchema
};
var roomCommandBase = {
  ...commandBase,
  roomId: identifierSchema
};
var stateChangingCommandBase = {
  ...roomCommandBase,
  expectedRoomRevision: revisionSchema
};
var command = (type, base, payload) => z.object({
  ...base,
  type: z.literal(type),
  payload: z.object(payload).strict()
}).strict();
var clientCommandSchema = z.discriminatedUnion("type", [
  command("room.create", commandBase, {
    displayName: z.string().trim().min(1).max(32)
  }),
  command("room.join", commandBase, {
    roomCode: z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{6}$/),
    displayName: z.string().trim().min(1).max(32)
  }),
  command("room.resume", commandBase, {
    roomId: identifierSchema,
    playerId: identifierSchema,
    reconnectToken: z.string().min(32).max(256)
  }),
  command("room.leave", roomCommandBase, {}),
  command("room.close", stateChangingCommandBase, {}),
  command("player.rename", stateChangingCommandBase, {
    displayName: z.string().trim().min(1).max(32)
  }),
  command("player.availability", stateChangingCommandBase, {
    availability: availabilitySchema
  }),
  command("player.ready", stateChangingCommandBase, {
    ready: z.boolean()
  }),
  command("selection.set", stateChangingCommandBase, {
    selection: roomSelectionSchema.omit({
      selectionRevision: true,
      selectedByPlayerId: true,
      selectedAtServerMs: true
    })
  }),
  command("selection.clear", stateChangingCommandBase, {}),
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
  command(
    "results.returnToSelection",
    stateChangingCommandBase,
    {}
  ),
  command("clock.ping", roomCommandBase, {
    clientSentAtPerformanceMs: timestampSchema
  })
]);
var rejectionCodeSchema = z.enum([
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
  "reconnect-grace-expired"
]);
var commandAcceptedSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("command.accepted"),
  commandId: identifierSchema,
  roomRevision: revisionSchema.nullable()
}).strict();
var commandRejectedSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("command.rejected"),
  commandId: identifierSchema,
  code: rejectionCodeSchema,
  message: z.string().min(1).max(240),
  roomRevision: revisionSchema.nullable()
}).strict();
var roomSnapshotMessageSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("room.snapshot"),
  room: roomStateSchema
}).strict();
var sessionCredentialsSchema = z.object({
  roomId: identifierSchema,
  playerId: identifierSchema,
  reconnectToken: z.string().min(32).max(256)
}).strict();
var roomCreatedMessageSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("room.created"),
  room: roomStateSchema,
  credentials: sessionCredentialsSchema
}).strict();
var roomJoinedMessageSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("room.joined"),
  room: roomStateSchema,
  credentials: sessionCredentialsSchema
}).strict();
var roomResumedMessageSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("room.resumed"),
  room: roomStateSchema,
  credentials: sessionCredentialsSchema
}).strict();
var roomClosedMessageSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("room.closed"),
  roomId: identifierSchema,
  reason: closeReasonSchema,
  message: z.string().min(1).max(240)
}).strict();
var clockPongMessageSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("clock.pong"),
  clientSentAtPerformanceMs: timestampSchema,
  serverReceivedAtMs: timestampSchema,
  serverSentAtMs: timestampSchema
}).strict();
var serverErrorMessageSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("server.error"),
  code: z.string().trim().min(1).max(80),
  message: z.string().min(1).max(240)
}).strict();
var serverMessageSchema = z.discriminatedUnion("type", [
  commandAcceptedSchema,
  commandRejectedSchema,
  roomCreatedMessageSchema,
  roomJoinedMessageSchema,
  roomResumedMessageSchema,
  roomSnapshotMessageSchema,
  roomClosedMessageSchema,
  clockPongMessageSchema,
  serverErrorMessageSchema
]);

// server/roomRegistry.ts
import {
  randomBytes,
  randomInt,
  randomUUID
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
    phase: "selecting",
    hostPlayerId: options.hostPlayerId,
    players: [host],
    selection: null,
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
  if (action.ready && !player.availability.audioReady) {
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
  next.phase = "selecting";
  resetPlayersForSelection(next.players);
  clearGameplayState(next);
  return acceptChanged(next, action.nowMs);
}
function beginReadyCheck(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "selecting") {
    return reject(state, "invalid-phase", "Ready check cannot begin now.");
  }
  if (!state.selection) {
    return reject(
      state,
      "selection-required",
      "Select a chart before beginning ready check."
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
  if (!state.selection) {
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
  if (!state.selection || action.score.selectionRevision !== state.selectionRevision) {
    return reject(
      state,
      "stale-selection-revision",
      "The score belongs to a different selection."
    );
  }
  const player = findPlayer(state, action.actorPlayerId);
  const previous = player.liveScore;
  const maximumScore = state.selection.tapCount * 1e3;
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
  if (state.phase !== "playing") {
    return reject(state, "invalid-phase", "Results are not accepted now.");
  }
  const player = findPlayer(state, action.actorPlayerId);
  if (player.finalResult) {
    return reject(
      state,
      "already-finished",
      "A final result was already submitted."
    );
  }
  if (!state.selection || action.result.selectionRevision !== state.selectionRevision) {
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
  nextPlayer.liveScore = { ...action.result };
  nextPlayer.finalResult = { ...action.result };
  next.results.push({
    playerId: action.actorPlayerId,
    result: { ...action.result }
  });
  if (next.resultsDeadlineAtServerMs === null) {
    const expectedEnd = next.startSchedule ? next.startSchedule.startAtServerMs + next.selection.durationSeconds * 1e3 + 5e3 : action.nowMs;
    next.resultsDeadlineAtServerMs = Math.max(
      action.nowMs + 15e3,
      expectedEnd
    );
  }
  const requiredPlayers = next.players.filter(
    (candidate) => candidate.connectionStatus === "connected"
  );
  if (requiredPlayers.length > 0 && requiredPlayers.every((candidate) => candidate.finalResult !== null)) {
    next.phase = "results";
  }
  return acceptChanged(next, action.nowMs);
}
function replay(state, action) {
  const hostCheck = requireHost(state, action.actorPlayerId);
  if (hostCheck) return hostCheck;
  if (state.phase !== "results") {
    return reject(state, "invalid-phase", "Replay is not available now.");
  }
  if (!state.selection) {
    return reject(state, "selection-required", "No chart is selected.");
  }
  const next = cloneState(state);
  next.phase = "ready-check";
  clearGameplayState(next);
  next.players.forEach((player) => {
    player.ready = false;
  });
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
  clearGameplayState(next);
  next.players.forEach((player) => {
    player.ready = false;
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
    next.phase = "results";
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
    finalResult: null
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
function resetPlayersForSelection(players) {
  players.forEach((player) => {
    player.availability = createUncheckedAvailability();
    player.ready = false;
    player.scheduleStatus = "not-scheduled";
    player.liveScore = null;
    player.finalResult = null;
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
  return Boolean(
    state.selection && player.availability.status === "matching-chart" && player.availability.selectionRevision === state.selectionRevision && player.availability.chartHash === state.selection.chartHash
  );
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
    this.createRoomId = options.createRoomId ?? randomUUID;
    this.createPlayerId = options.createPlayerId ?? randomUUID;
    this.createReconnectToken = options.createReconnectToken ?? (() => randomBytes(32).toString("hex"));
    this.createRoomCode = options.createRoomCode ?? createRandomRoomCode;
  }
  getRoomCount() {
    return this.rooms.size;
  }
  getMembership(socketId) {
    return this.memberships.get(socketId) ?? null;
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
        roomRevision: transition.state.revision
      },
      effects
    };
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
      case "selection.set":
        return {
          type: "selection.set",
          selection: command2.payload.selection,
          ...base
        };
      case "selection.clear":
        return { type: "selection.clear", ...base };
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
var DanceVisionServer = class {
  port;
  host;
  tickIntervalMs;
  registry;
  httpServer;
  io;
  tickTimer = null;
  constructor(options = {}) {
    this.port = options.port ?? 3001;
    this.host = options.host ?? "127.0.0.1";
    this.tickIntervalMs = options.tickIntervalMs ?? 250;
    this.registry = new RoomRegistry(options.registryOptions);
    this.httpServer = createHttpServer((request, response) => {
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
      response.writeHead(404, {
        "content-type": "application/json; charset=utf-8"
      });
      response.end(JSON.stringify({
        error: "not-found"
      }));
    });
    this.io = new SocketIoServer(this.httpServer, {
      cors: {
        origin: options.allowedOrigins ?? [
          "http://localhost:5173",
          "http://127.0.0.1:5173"
        ],
        methods: ["GET", "POST"]
      }
    });
    this.io.on("connection", (socket) => {
      this.configureSocket(socket);
    });
  }
  async start() {
    if (this.httpServer.listening) {
      return this.getUrl();
    }
    await new Promise((resolve, reject2) => {
      const handleError = (error) => {
        this.httpServer.off("listening", handleListening);
        reject2(error);
      };
      const handleListening = () => {
        this.httpServer.off("error", handleError);
        resolve();
      };
      this.httpServer.once("error", handleError);
      this.httpServer.once("listening", handleListening);
      this.httpServer.listen(this.port, this.host);
    });
    this.tickTimer = setInterval(() => {
      this.publishEffects(this.registry.tick());
    }, this.tickIntervalMs);
    this.tickTimer.unref?.();
    return this.getUrl();
  }
  async stop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    await new Promise((resolve) => {
      this.io.close(() => resolve());
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
      default:
        result = this.registry.handleMemberCommand(
          socket.id,
          command2
        );
        break;
    }
    if (result.joinedRoomId) {
      await socket.join(result.joinedRoomId);
    }
    if (result.leftRoomId) {
      await socket.leave(result.leftRoomId);
    }
    acknowledge(result.response);
    this.publishEffects(result.effects);
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
var DEFAULT_PORT = 3001;
function loadServerConfig(environment = process.env) {
  const parsedPort = Number.parseInt(
    environment.PORT ?? "",
    10
  );
  const allowedOrigins = (environment.CLIENT_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((origin) => origin.trim()).filter(Boolean);
  return {
    port: Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT,
    allowedOrigins
  };
}

// server/index.ts
var config = loadServerConfig();
var server = new DanceVisionServer({
  port: config.port,
  host: "0.0.0.0",
  allowedOrigins: config.allowedOrigins
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
