import {
    COUNTDOWN_DURATION_MS,
    MAX_ROOM_PLAYERS,
    PROTOCOL_VERSION,
    RECONNECT_GRACE_MS,
    ROOM_INACTIVITY_MS,
} from "../../shared/constants";
import type {
    Availability,
    FinalResult,
    LiveScore,
    RejectionCode,
    RoomPlayer,
    RoomPreview,
    RoomSelection,
    RoomState,
} from "../../shared/schemas";
import { roomSelectionSchema } from "../../shared/schemas";
import type { PlayerAssetPreparation, PlayerChartChoice, RoomSongPackage } from "../../shared/relaySchemas";
import { roomSongPackageSchema } from "../../shared/relaySchemas";

export type SelectionProposal = Omit<
    RoomSelection,
    | "selectionRevision"
    | "selectedByPlayerId"
    | "selectedAtServerMs"
>;
export type PreviewProposal = Omit<RoomPreview,
    "previewRevision" | "publishedByPlayerId" | "publishedAtServerMs">;
export type SongPackageProposal = Omit<RoomSongPackage,
    "selectionRevision" | "selectedByPlayerId" | "selectedAtServerMs">;

interface ActorAction {
    actorPlayerId: string;
    expectedRoomRevision: number;
    nowMs: number;
}

export type RoomAction =
    | {
        type: "player.join";
        playerId: string;
        displayName: string;
        nowMs: number;
    }
    | {
        type: "player.disconnect";
        playerId: string;
        nowMs: number;
    }
    | {
        type: "player.resume";
        playerId: string;
        nowMs: number;
    }
    | ({ type: "player.leave" } & ActorAction)
    | ({ type: "player.rename"; displayName: string } & ActorAction)
    | ({ type: "player.kick"; playerId: string } & ActorAction)
    | ({
        type: "player.availability";
        availability: Availability;
    } & ActorAction)
    | ({ type: "player.ready"; ready: boolean } & ActorAction)
    | ({ type: "player.clockQuality"; usable: boolean } & ActorAction)
    | ({
        type: "selection.set";
        selection: SelectionProposal;
    } & ActorAction)
    | ({ type: "selection.clear" } & ActorAction)
    | ({ type: "preview.publish"; preview: PreviewProposal } & ActorAction)
    | ({ type: "preview.clear" } & ActorAction)
    | ({ type: "songPackage.commit"; songPackage: SongPackageProposal } & ActorAction)
    | ({ type: "player.chart.select"; choice: PlayerChartChoice } & ActorAction)
    | ({ type: "player.asset.status"; preparation: PlayerAssetPreparation } & ActorAction)
    | ({ type: "readyCheck.begin" } & ActorAction)
    | ({ type: "readyCheck.cancel" } & ActorAction)
    | ({ type: "countdown.request" } & ActorAction)
    | ({ type: "countdown.scheduled" } & ActorAction)
    | ({ type: "countdown.cancel" } & ActorAction)
    | ({ type: "countdown.failed" } & ActorAction)
    | ({ type: "game.score"; score: LiveScore } & ActorAction)
    | ({ type: "game.finished"; result: FinalResult } & ActorAction)
    | ({ type: "results.replay" } & ActorAction)
    | ({ type: "results.replayVote"; wantsReplay: boolean } & ActorAction)
    | ({ type: "results.returnToSelection" } & ActorAction)
    | ({ type: "room.close" } & ActorAction)
    | {
        type: "server.tick";
        nowMs: number;
    };

export interface RoomTransitionAccepted {
    accepted: true;
    state: RoomState;
}

export interface RoomTransitionRejected {
    accepted: false;
    state: RoomState;
    code: RejectionCode;
    message: string;
}

export type RoomTransition =
    | RoomTransitionAccepted
    | RoomTransitionRejected;

export interface CreateRoomOptions {
    roomId: string;
    roomCode: string;
    hostPlayerId: string;
    hostDisplayName: string;
    nowMs: number;
}

export function createRoomState(
    options: CreateRoomOptions,
): RoomState {
    const host = createPlayer(
        options.hostPlayerId,
        options.hostDisplayName,
        options.nowMs,
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
        closeReason: null,
    };
}

export function transitionRoom(
    state: RoomState,
    action: RoomAction,
): RoomTransition {
    if (state.phase === "closed") {
        return reject(state, "invalid-phase", "The room is closed.");
    }

    if (isActorAction(action)) {
        const actor = findPlayer(state, action.actorPlayerId);

        if (!actor) {
            return reject(
                state,
                "not-a-member",
                "The player is not a member of this room.",
            );
        }

        if (action.expectedRoomRevision !== state.revision) {
            return reject(
                state,
                "stale-room-revision",
                "The room changed before this command was processed.",
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

function joinPlayer(
    state: RoomState,
    action: Extract<RoomAction, { type: "player.join" }>,
): RoomTransition {
    if (state.phase !== "selecting" && state.phase !== "ready-check") {
        return reject(
            state,
            "game-in-progress",
            "Players cannot join this room right now.",
        );
    }

    if (state.players.length >= MAX_ROOM_PLAYERS) {
        return reject(state, "room-full", "The room is full.");
    }

    if (findPlayer(state, action.playerId)) {
        return reject(
            state,
            "invalid-command",
            "That player is already in the room.",
        );
    }

    const next = cloneState(state);
    next.players.push(
        createPlayer(action.playerId, action.displayName, action.nowMs),
    );
    updateDisplayLabels(next.players);
    return acceptChanged(next, action.nowMs);
}

function disconnectPlayer(
    state: RoomState,
    playerId: string,
    nowMs: number,
): RoomTransition {
    const player = findPlayer(state, playerId);

    if (!player) {
        return reject(state, "not-a-member", "Unknown player.");
    }

    if (player.connectionStatus === "disconnected") {
        return { accepted: true, state };
    }

    const next = cloneState(state);
    const nextPlayer = findPlayer(next, playerId)!;
    nextPlayer.connectionStatus = "disconnected";
    nextPlayer.disconnectedAtServerMs = nowMs;
    nextPlayer.ready = false;

    if (next.phase === "countdown") {
        resetToReadyCheck(next);
    }

    return acceptChanged(next, nowMs);
}

function resumePlayer(
    state: RoomState,
    playerId: string,
    nowMs: number,
): RoomTransition {
    const player = findPlayer(state, playerId);

    if (!player) {
        return reject(state, "not-a-member", "Unknown player.");
    }

    if (player.connectionStatus === "connected") {
        return { accepted: true, state };
    }

    if (
        player.disconnectedAtServerMs === null ||
        nowMs - player.disconnectedAtServerMs > RECONNECT_GRACE_MS
    ) {
        return reject(
            state,
            "reconnect-grace-expired",
            "The reconnect window has expired.",
        );
    }

    const next = cloneState(state);
    const nextPlayer = findPlayer(next, playerId)!;
    nextPlayer.connectionStatus = "connected";
    nextPlayer.disconnectedAtServerMs = null;
    return acceptChanged(next, nowMs);
}

function leavePlayer(
    state: RoomState,
    playerId: string,
    nowMs: number,
): RoomTransition {
    const next = cloneState(state);
    next.players = next.players.filter(
        (player) => player.playerId !== playerId,
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

function renamePlayer(
    state: RoomState,
    action: Extract<RoomAction, { type: "player.rename" }>,
): RoomTransition {
    if (state.phase !== "selecting" && state.phase !== "ready-check") {
        return reject(state, "invalid-phase", "Names cannot change now.");
    }

    const displayName = action.displayName.trim();

    if (displayName.length < 1 || displayName.length > 32) {
        return reject(
            state,
            "display-name-invalid",
            "Display names must contain 1 to 32 characters.",
        );
    }

    const next = cloneState(state);
    findPlayer(next, action.actorPlayerId)!.displayName = displayName;
    updateDisplayLabels(next.players);
    return acceptChanged(next, action.nowMs);
}

function kickPlayer(
    state: RoomState,
    action: Extract<RoomAction, { type: "player.kick" }>,
): RoomTransition {
    const hostCheck = requireHost(state, action.actorPlayerId);
    if (hostCheck) return hostCheck;
    if (action.playerId === state.hostPlayerId) {
        return reject(state, "invalid-payload", "The host cannot kick themselves.");
    }
    if (
        state.phase !== "selecting" &&
        state.phase !== "ready-check" &&
        state.phase !== "results"
    ) {
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

function reportAvailability(
    state: RoomState,
    action: Extract<RoomAction, { type: "player.availability" }>,
): RoomTransition {
    if (state.phase !== "selecting" && state.phase !== "ready-check") {
        return reject(
            state,
            "invalid-phase",
            "Chart availability cannot change now.",
        );
    }

    if (
        !state.selection ||
        action.availability.selectionRevision !== state.selectionRevision
    ) {
        return reject(
            state,
            "stale-selection-revision",
            "Availability was checked for an old selection.",
        );
    }

    if (
        action.availability.status === "matching-chart" &&
        action.availability.chartHash !== state.selection.chartHash
    ) {
        return reject(
            state,
            "chart-not-matched",
            "The reported chart hash does not match the room selection.",
        );
    }

    const next = cloneState(state);
    const player = findPlayer(next, action.actorPlayerId)!;
    player.availability = { ...action.availability };
    player.ready = false;
    return acceptChanged(next, action.nowMs);
}

function setReady(
    state: RoomState,
    action: Extract<RoomAction, { type: "player.ready" }>,
): RoomTransition {
    if (state.phase !== "ready-check") {
        return reject(
            state,
            "invalid-phase",
            "Readiness can only change during ready check.",
        );
    }

    const player = findPlayer(state, action.actorPlayerId)!;

    if (action.ready && !hasMatchingChart(player, state)) {
        return reject(
            state,
            "chart-not-matched",
            "An exact chart match is required before becoming ready.",
        );
    }

    if (action.ready && !state.songPackage && !player.availability.audioReady) {
        return reject(
            state,
            "audio-not-ready",
            "Local audio must be ready before becoming ready.",
        );
    }

    const next = cloneState(state);
    findPlayer(next, action.actorPlayerId)!.ready = action.ready;
    return acceptChanged(next, action.nowMs);
}

function setClockQuality(
    state: RoomState,
    action: Extract<RoomAction, { type: "player.clockQuality" }>,
): RoomTransition {
    const next = cloneState(state);
    findPlayer(next, action.actorPlayerId)!.clockQuality =
        action.usable ? "usable" : "unusable";
    return acceptChanged(next, action.nowMs);
}

function setSelection(
    state: RoomState,
    action: Extract<RoomAction, { type: "selection.set" }>,
): RoomTransition {
    const hostCheck = requireHost(state, action.actorPlayerId);
    if (hostCheck) return hostCheck;

    if (state.phase !== "selecting" && state.phase !== "ready-check") {
        return reject(state, "invalid-phase", "Selection is locked now.");
    }

    const proposedSelection: RoomSelection = {
        ...action.selection,
        selectionRevision: state.selectionRevision + 1,
        selectedByPlayerId: action.actorPlayerId,
        selectedAtServerMs: action.nowMs,
    };

    if (!roomSelectionSchema.safeParse(proposedSelection).success) {
        return reject(
            state,
            "invalid-payload",
            "The chart identity version is unsupported.",
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

function clearSelection(
    state: RoomState,
    action: Extract<RoomAction, { type: "selection.clear" }>,
): RoomTransition {
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

function publishPreview(
    state: RoomState,
    action: Extract<RoomAction, { type: "preview.publish" }>,
): RoomTransition {
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
        publishedAtServerMs: action.nowMs,
    };
    return acceptChanged(next, action.nowMs);
}

function clearPreview(
    state: RoomState,
    action: Extract<RoomAction, { type: "preview.clear" }>,
): RoomTransition {
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

function commitSongPackage(
    state: RoomState,
    action: Extract<RoomAction, { type: "songPackage.commit" }>,
): RoomTransition {
    const hostCheck = requireHost(state, action.actorPlayerId);
    if (hostCheck) return hostCheck;
    if (state.phase !== "selecting" && state.phase !== "ready-check") {
        return reject(state, "invalid-phase", "The room song is locked now.");
    }
    const songPackage: RoomSongPackage = {
        ...action.songPackage,
        selectionRevision: state.selectionRevision + 1,
        selectedByPlayerId: action.actorPlayerId,
        selectedAtServerMs: action.nowMs,
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

function selectPlayerChart(
    state: RoomState,
    action: Extract<RoomAction, { type: "player.chart.select" }>,
): RoomTransition {
    if (state.phase !== "selecting" && state.phase !== "ready-check") {
        return reject(state, "invalid-phase", "Difficulty selection is locked now.");
    }
    if (!state.songPackage || action.choice.selectionRevision !== state.selectionRevision) {
        return reject(state, "stale-selection-revision", "Choose a difficulty from the current song.");
    }
    const matches = state.songPackage.charts.some((chart) =>
        chart.chartId === action.choice.chartId && chart.chartHash === action.choice.chartHash);
    if (!matches) return reject(state, "chart-not-matched", "That difficulty is not part of the room song.");
    const next = cloneState(state);
    const player = findPlayer(next, action.actorPlayerId)!;
    player.chartChoice = { ...action.choice };
    player.ready = false;
    return acceptChanged(next, action.nowMs);
}

function setPlayerAssetStatus(
    state: RoomState,
    action: Extract<RoomAction, { type: "player.asset.status" }>,
): RoomTransition {
    if (!state.songPackage || action.preparation.selectionRevision !== state.selectionRevision) {
        return reject(state, "stale-selection-revision", "Asset status belongs to an old song.");
    }
    const next = cloneState(state);
    const player = findPlayer(next, action.actorPlayerId)!;
    player.assetPreparation = { ...action.preparation };
    player.ready = false;
    return acceptChanged(next, action.nowMs);
}

function beginReadyCheck(
    state: RoomState,
    action: Extract<RoomAction, { type: "readyCheck.begin" }>,
): RoomTransition {
    const hostCheck = requireHost(state, action.actorPlayerId);
    if (hostCheck) return hostCheck;

    if (state.phase !== "selecting") {
        return reject(state, "invalid-phase", "Ready check cannot begin now.");
    }

    if (!state.selection && !state.songPackage) {
        return reject(
            state,
            "selection-required",
            "Confirm a song before beginning ready check.",
        );
    }

    const next = cloneState(state);
    next.phase = "ready-check";
    next.players.forEach((player) => {
        player.ready = false;
    });
    return acceptChanged(next, action.nowMs);
}

function cancelReadyCheck(
    state: RoomState,
    action: Extract<RoomAction, { type: "readyCheck.cancel" }>,
): RoomTransition {
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

function requestCountdown(
    state: RoomState,
    action: Extract<RoomAction, { type: "countdown.request" }>,
): RoomTransition {
    const hostCheck = requireHost(state, action.actorPlayerId);
    if (hostCheck) return hostCheck;

    if (state.phase !== "ready-check") {
        return reject(state, "invalid-phase", "Countdown cannot begin now.");
    }

    if (!state.selection && !state.songPackage) {
        return reject(state, "selection-required", "No chart is selected.");
    }

    const connectedPlayers = state.players.filter(
        (player) => player.connectionStatus === "connected",
    );

    if (
        connectedPlayers.length !== state.players.length ||
        connectedPlayers.some(
            (player) => !player.ready || !hasMatchingChart(player, state),
        )
    ) {
        return reject(
            state,
            "players-not-ready",
            "Every player must be connected, matched, and ready.",
        );
    }

    if (
        connectedPlayers.some(
            (player) => player.clockQuality !== "usable",
        )
    ) {
        return reject(
            state,
            "clock-not-synchronized",
            "Every player needs usable clock synchronization.",
        );
    }

    const next = cloneState(state);
    next.phase = "countdown";
    next.startSchedule = {
        selectionRevision: next.selectionRevision,
        issuedAtServerMs: action.nowMs,
        startAtServerMs: action.nowMs + COUNTDOWN_DURATION_MS,
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

function confirmScheduled(
    state: RoomState,
    action: Extract<RoomAction, { type: "countdown.scheduled" }>,
): RoomTransition {
    if (state.phase !== "countdown") {
        return reject(state, "invalid-phase", "No countdown is active.");
    }

    const next = cloneState(state);
    findPlayer(next, action.actorPlayerId)!.scheduleStatus = "scheduled";
    return acceptChanged(next, action.nowMs);
}

function cancelCountdown(
    state: RoomState,
    action: Extract<RoomAction, { type: "countdown.cancel" }>,
): RoomTransition {
    const hostCheck = requireHost(state, action.actorPlayerId);
    if (hostCheck) return hostCheck;

    if (state.phase !== "countdown") {
        return reject(state, "invalid-phase", "No countdown is active.");
    }

    const next = cloneState(state);
    resetToReadyCheck(next);
    return acceptChanged(next, action.nowMs);
}

function failCountdown(
    state: RoomState,
    action: Extract<RoomAction, { type: "countdown.failed" }>,
): RoomTransition {
    if (state.phase !== "countdown") {
        return reject(state, "invalid-phase", "No countdown is active.");
    }

    const next = cloneState(state);
    findPlayer(next, action.actorPlayerId)!.scheduleStatus = "failed";
    resetToReadyCheck(next);
    return acceptChanged(next, action.nowMs);
}

function reportScore(
    state: RoomState,
    action: Extract<RoomAction, { type: "game.score" }>,
): RoomTransition {
    if (state.phase !== "playing") {
        return reject(state, "invalid-phase", "Scores are not accepted now.");
    }

    if (action.score.selectionRevision !== state.selectionRevision) {
        return reject(
            state,
            "stale-selection-revision",
            "The score belongs to a different selection.",
        );
    }

    const player = findPlayer(state, action.actorPlayerId)!;
    const selectedChart = selectedChartForPlayer(state, player);
    if (!selectedChart) return reject(state, "chart-not-matched", "The player has no current chart choice.");
    const previous = player.liveScore;
    const maximumScore = selectedChart.tapCount * 1_000;

    if (
        action.score.score > maximumScore ||
        (previous !== null &&
            (action.score.sequence <= previous.sequence ||
                action.score.score < previous.score ||
                action.score.maxCombo < previous.maxCombo))
    ) {
        return reject(
            state,
            "score-regressed",
            "The score snapshot is inconsistent with prior state.",
        );
    }

    const next = cloneState(state);
    findPlayer(next, action.actorPlayerId)!.liveScore = {
        ...action.score,
    };
    return acceptChanged(next, action.nowMs);
}

function reportFinished(
    state: RoomState,
    action: Extract<RoomAction, { type: "game.finished" }>,
): RoomTransition {
    const player = findPlayer(state, action.actorPlayerId)!;

    if (player.finalResult) {
        if (
            player.finalResult.selectionRevision === action.result.selectionRevision &&
            player.finalResult.sequence === action.result.sequence &&
            player.finalResult.score === action.result.score
        ) {
            /* Final-result retries are safe after a lost ack or snapshot. */
            return { accepted: true, state };
        }
        return reject(
            state,
            "already-finished",
            "A final result was already submitted.",
        );
    }

    if (state.phase !== "playing") {
        return reject(state, "invalid-phase", "Results are not accepted now.");
    }

    if (action.result.selectionRevision !== state.selectionRevision) {
        return reject(
            state,
            "stale-selection-revision",
            "The result belongs to a different selection.",
        );
    }

    if (player.liveScore && action.result.score < player.liveScore.score) {
        return reject(
            state,
            "score-regressed",
            "The final result cannot be below the live score.",
        );
    }

    const next = cloneState(state);
    const nextPlayer = findPlayer(next, action.actorPlayerId)!;
    const {
        finishedAtServerMs: _finishedAtServerMs,
        ...liveScore
    } = action.result;
    nextPlayer.liveScore = liveScore;
    nextPlayer.finalResult = { ...action.result };
    next.results.push({
        playerId: action.actorPlayerId,
        result: { ...action.result },
    });

    if (next.resultsDeadlineAtServerMs === null) {
        const selectedChart = selectedChartForPlayer(next, nextPlayer);
        const expectedEnd = next.startSchedule && selectedChart
            ? next.startSchedule.startAtServerMs +
              selectedChart.durationSeconds * 1_000 + 5_000
            : action.nowMs;
        next.resultsDeadlineAtServerMs = Math.max(
            action.nowMs + 15_000,
            expectedEnd,
        );
    }

    const requiredPlayers = next.players.filter(
        (candidate) => candidate.connectionStatus === "connected",
    );

    if (
        requiredPlayers.length > 0 &&
        requiredPlayers.every((candidate) => candidate.finalResult !== null)
    ) {
        enterResults(next);
    }

    return acceptChanged(next, action.nowMs);
}

function selectedChartForPlayer(state: RoomState, player: RoomPlayer): { tapCount: number; durationSeconds: number } | null {
    if (state.songPackage && player.chartChoice) {
        return state.songPackage.charts.find((chart) =>
            chart.chartId === player.chartChoice?.chartId && chart.chartHash === player.chartChoice.chartHash) ?? null;
    }
    return state.selection;
}

function replay(
    state: RoomState,
    action: Extract<RoomAction, { type: "results.replay" }>,
): RoomTransition {
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

function voteReplay(
    state: RoomState,
    action: Extract<RoomAction, { type: "results.replayVote" }>,
): RoomTransition {
    if (state.phase !== "results") return reject(state, "invalid-phase", "Replay voting is available after everyone finishes.");
    const next = cloneState(state);
    findPlayer(next, action.actorPlayerId)!.replayRequested = action.wantsReplay;
    return acceptChanged(next, action.nowMs);
}

function returnToSelection(
    state: RoomState,
    action: Extract<RoomAction, { type: "results.returnToSelection" }>,
): RoomTransition {
    const hostCheck = requireHost(state, action.actorPlayerId);
    if (hostCheck) return hostCheck;

    if (state.phase !== "results") {
        return reject(
            state,
            "invalid-phase",
            "The room is not showing results.",
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

function closeByHost(
    state: RoomState,
    action: Extract<RoomAction, { type: "room.close" }>,
): RoomTransition {
    const hostCheck = requireHost(state, action.actorPlayerId);
    if (hostCheck) return hostCheck;

    const next = cloneState(state);
    closeRoom(next, "host-closed");
    return acceptChanged(next, action.nowMs);
}

function advanceServerTime(
    state: RoomState,
    nowMs: number,
): RoomTransition {
    const next = cloneState(state);
    let changed = false;

    const expiredPlayerIds = next.players
        .filter(
            (player) =>
                player.connectionStatus === "disconnected" &&
                player.disconnectedAtServerMs !== null &&
                nowMs - player.disconnectedAtServerMs > RECONNECT_GRACE_MS,
        )
        .map((player) => player.playerId);

    if (expiredPlayerIds.length > 0) {
        next.players = next.players.filter(
            (player) => !expiredPlayerIds.includes(player.playerId),
        );
        changed = true;

        if (next.players.length === 0) {
            closeRoom(next, "room-empty");
        } else if (expiredPlayerIds.includes(next.hostPlayerId)) {
            transferHost(next);
        }

        updateDisplayLabels(next.players);
    }

    if (
        next.phase === "countdown" &&
        next.startSchedule &&
        nowMs >= next.startSchedule.startAtServerMs
    ) {
        if (
            next.players.every(
                (player) =>
                    player.connectionStatus === "connected" &&
                    player.scheduleStatus === "scheduled",
            )
        ) {
            next.phase = "playing";
        } else {
            resetToReadyCheck(next);
        }
        changed = true;
    }

    if (
        next.phase === "playing" &&
        next.resultsDeadlineAtServerMs !== null &&
        nowMs >= next.resultsDeadlineAtServerMs
    ) {
        enterResults(next);
        changed = true;
    }

    if (
        (next.phase === "selecting" || next.phase === "ready-check") &&
        nowMs >= next.expiresAtServerMs
    ) {
        closeRoom(next, "room-expired");
        changed = true;
    }

    return changed
        ? acceptChanged(next, nowMs, false)
        : { accepted: true, state };
}

function createPlayer(
    playerId: string,
    displayName: string,
    nowMs: number,
): RoomPlayer {
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
        assetPreparation: null,
    };
}

function createUncheckedAvailability(): Availability {
    return {
        status: "unchecked",
        selectionRevision: null,
        chartHash: null,
        audioReady: false,
    };
}

function enterResults(state: RoomState): void {
    if (state.phase === "results") return;
    const completed = state.players.filter(
        (player) => player.finalResult !== null,
    );
    const highestScore = completed.reduce(
        (highest, player) => Math.max(highest, player.finalResult!.score),
        -1,
    );
    if (highestScore >= 0) {
        completed.forEach((player) => {
            if (player.finalResult!.score === highestScore) {
                player.winCount += 1;
            }
        });
    }
    state.phase = "results";
}

function resetPlayersForSelection(players: RoomPlayer[]): void {
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

function clearGameplayState(state: RoomState): void {
    state.startSchedule = null;
    state.results = [];
    state.resultsDeadlineAtServerMs = null;
    state.players.forEach((player) => {
        player.scheduleStatus = "not-scheduled";
        player.liveScore = null;
        player.finalResult = null;
    });
}

function resetToReadyCheck(state: RoomState): void {
    state.phase = "ready-check";
    state.startSchedule = null;
    state.resultsDeadlineAtServerMs = null;
    state.players.forEach((player) => {
        player.ready = false;
        player.scheduleStatus = "not-scheduled";
    });
}

function closeRoom(
    state: RoomState,
    reason: RoomState["closeReason"],
): void {
    state.phase = "closed";
    state.closeReason = reason;
    state.startSchedule = null;
}

function transferHost(state: RoomState): void {
    const nextHost = state.players
        .filter((player) => player.connectionStatus === "connected")
        .sort(
            (left, right) =>
                left.joinedAtServerMs - right.joinedAtServerMs,
        )[0];

    if (nextHost) {
        state.hostPlayerId = nextHost.playerId;
    } else {
        closeRoom(state, "room-empty");
    }
}

function updateDisplayLabels(players: RoomPlayer[]): void {
    const counts = new Map<string, number>();
    players
        .sort(
            (left, right) =>
                left.joinedAtServerMs - right.joinedAtServerMs,
        )
        .forEach((player) => {
            const count = (counts.get(player.displayName) ?? 0) + 1;
            counts.set(player.displayName, count);
            player.displayLabel =
                count === 1
                    ? player.displayName
                    : `${player.displayName} (${count})`;
        });
}

function hasMatchingChart(
    player: RoomPlayer,
    state: RoomState,
): boolean {
    if (state.songPackage) {
        return Boolean(
            player.chartChoice?.selectionRevision === state.selectionRevision &&
            player.assetPreparation?.selectionRevision === state.selectionRevision &&
            player.assetPreparation.status === "prepared" &&
            player.assetPreparation.verifiedAudioHash === state.songPackage.audio.sha256,
        );
    }
    return Boolean(state.selection &&
        player.availability.status === "matching-chart" &&
        player.availability.selectionRevision === state.selectionRevision &&
        player.availability.chartHash === state.selection.chartHash);
}

function requireHost(
    state: RoomState,
    playerId: string,
): RoomTransitionRejected | null {
    return state.hostPlayerId === playerId
        ? null
        : reject(state, "not-host", "Only the host can do that.");
}

function findPlayer(
    state: RoomState,
    playerId: string,
): RoomPlayer | undefined {
    return state.players.find((player) => player.playerId === playerId);
}

function isActorAction(action: RoomAction): action is Extract<
    RoomAction,
    ActorAction
> {
    return "actorPlayerId" in action;
}

function cloneState(state: RoomState): RoomState {
    return {
        ...state,
        players: state.players.map((player) => ({
            ...player,
            availability: { ...player.availability },
            liveScore: player.liveScore ? { ...player.liveScore } : null,
            finalResult: player.finalResult
                ? { ...player.finalResult }
                : null,
        })),
        selection: state.selection ? { ...state.selection } : null,
        startSchedule: state.startSchedule
            ? { ...state.startSchedule }
            : null,
        results: state.results.map((entry) => ({
            playerId: entry.playerId,
            result: { ...entry.result },
        })),
    };
}

function acceptChanged(
    state: RoomState,
    nowMs: number,
    refreshExpiry = true,
): RoomTransitionAccepted {
    state.revision += 1;
    state.lastActivityAtServerMs = nowMs;
    if (refreshExpiry) {
        state.expiresAtServerMs = nowMs + ROOM_INACTIVITY_MS;
    }
    return { accepted: true, state };
}

function reject(
    state: RoomState,
    code: RejectionCode,
    message: string,
): RoomTransitionRejected {
    return {
        accepted: false,
        state,
        code,
        message,
    };
}
