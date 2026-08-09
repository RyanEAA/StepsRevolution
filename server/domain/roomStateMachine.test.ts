import { describe, expect, it } from "vitest";

import {
    CHART_IDENTITY_VERSION,
    COUNTDOWN_DURATION_MS,
    MAX_ROOM_PLAYERS,
    RECONNECT_GRACE_MS,
    ROOM_INACTIVITY_MS,
} from "../../shared/constants";
import type {
    Availability,
    FinalResult,
    LiveScore,
    RejectionCode,
    RoomState,
} from "../../shared/schemas";
import { serverMessageSchema } from "../../shared/schemas";
import {
    createRoomState,
    transitionRoom,
} from "./roomStateMachine";
import { ASSET_PROTOCOL_VERSION } from "../../shared/relaySchemas";
import type {
    RoomAction,
    RoomTransition,
    SelectionProposal,
} from "./roomStateMachine";

const HOST_ID = "host";
const GUEST_ID = "guest";
const CHART_HASH =
    `${CHART_IDENTITY_VERSION}:${"a".repeat(64)}`;

const selection: SelectionProposal = {
    songId: "song-1",
    chartId: "chart-1",
    chartHash: CHART_HASH,
    identityVersion: CHART_IDENTITY_VERSION,
    title: "Test Song",
    subtitle: "",
    artist: "Test Artist",
    stepType: "dance-single",
    difficulty: "Hard",
    meter: 8,
    tapCount: 100,
    durationSeconds: 120,
};

function createRoom(): RoomState {
    return createRoomState({
        roomId: "room-1",
        roomCode: "ABC234",
        hostPlayerId: HOST_ID,
        hostDisplayName: "Ryan",
        nowMs: 1_000,
    });
}

function accept(transition: RoomTransition): RoomState {
    expect(transition.accepted).toBe(true);
    if (!transition.accepted) {
        throw new Error(transition.message);
    }
    return transition.state;
}

function reject(
    transition: RoomTransition,
    code: RejectionCode,
): void {
    expect(transition.accepted).toBe(false);
    if (transition.accepted) {
        throw new Error("Expected transition rejection.");
    }
    expect(transition.code).toBe(code);
}

type ActorRoomAction = Extract<
    RoomAction,
    { actorPlayerId: string }
>;

type ActorActionInput = ActorRoomAction extends infer TAction
    ? TAction extends ActorRoomAction
        ? Omit<TAction, "expectedRoomRevision">
        : never
    : never;

function actorAction(
    state: RoomState,
    action: ActorActionInput,
): ActorRoomAction {
    return {
        ...action,
        expectedRoomRevision: state.revision,
    } as ActorRoomAction;
}

function joinGuest(state: RoomState, nowMs = 2_000): RoomState {
    return accept(transitionRoom(state, {
        type: "player.join",
        playerId: GUEST_ID,
        displayName: "Guest",
        nowMs,
    }));
}

function matchingAvailability(
    state: RoomState,
    audioReady = true,
): Availability {
    return {
        status: "matching-chart",
        selectionRevision: state.selectionRevision,
        chartHash: state.selection!.chartHash,
        audioReady,
    };
}

function prepareReadyRoom(): RoomState {
    let state = joinGuest(createRoom());
    state = accept(transitionRoom(state, actorAction(state, {
        type: "selection.set",
        actorPlayerId: HOST_ID,
        selection,
        nowMs: 3_000,
    })));

    for (const playerId of [HOST_ID, GUEST_ID]) {
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.availability",
            actorPlayerId: playerId,
            availability: matchingAvailability(state),
            nowMs: 4_000,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.clockQuality",
            actorPlayerId: playerId,
            usable: true,
            nowMs: 4_100,
        })));
    }

    state = accept(transitionRoom(state, actorAction(state, {
        type: "readyCheck.begin",
        actorPlayerId: HOST_ID,
        nowMs: 5_000,
    })));

    for (const playerId of [HOST_ID, GUEST_ID]) {
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.ready",
            actorPlayerId: playerId,
            ready: true,
            nowMs: 5_100,
        })));
    }

    return state;
}

function startPlaying(): RoomState {
    let state = prepareReadyRoom();
    state = accept(transitionRoom(state, actorAction(state, {
        type: "countdown.request",
        actorPlayerId: HOST_ID,
        nowMs: 6_000,
    })));

    for (const playerId of [HOST_ID, GUEST_ID]) {
        state = accept(transitionRoom(state, actorAction(state, {
            type: "countdown.scheduled",
            actorPlayerId: playerId,
            nowMs: 6_100,
        })));
    }

    return accept(transitionRoom(state, {
        type: "server.tick",
        nowMs: 6_000 + COUNTDOWN_DURATION_MS,
    }));
}

function score(
    state: RoomState,
    sequence: number,
    points: number,
): LiveScore {
    return {
        selectionRevision: state.selectionRevision,
        sequence,
        score: points,
        combo: sequence,
        maxCombo: sequence,
        perfectCount: sequence,
        greatCount: 0,
        goodCount: 0,
        missCount: 0,
        gameTimeSeconds: sequence,
    };
}

function result(
    state: RoomState,
    sequence: number,
    points: number,
    nowMs: number,
): FinalResult {
    return {
        ...score(state, sequence, points),
        finishedAtServerMs: nowMs,
    };
}

describe("room membership and revisions", () => {
    it("creates a selecting room with its host", () => {
        const state = createRoom();
        expect(state.phase).toBe("selecting");
        expect(state.players).toHaveLength(1);
        expect(state.hostPlayerId).toBe(HOST_ID);
        expect(state.revision).toBe(0);
    });

    it("allows duplicate names but gives them distinct labels", () => {
        const state = accept(transitionRoom(createRoom(), {
            type: "player.join",
            playerId: GUEST_ID,
            displayName: "Ryan",
            nowMs: 2_000,
        }));

        expect(state.players.map((player) => player.displayLabel)).toEqual([
            "Ryan",
            "Ryan (2)",
        ]);
    });

    it("enforces room capacity", () => {
        let state = createRoom();
        for (let index = 1; index < MAX_ROOM_PLAYERS; index += 1) {
            state = accept(transitionRoom(state, {
                type: "player.join",
                playerId: `player-${index}`,
                displayName: `Player ${index}`,
                nowMs: 1_000 + index,
            }));
        }

        reject(transitionRoom(state, {
            type: "player.join",
            playerId: "extra",
            displayName: "Extra",
            nowMs: 2_000,
        }), "room-full");
    });

    it("rejects stale commands without changing state", () => {
        const state = createRoom();
        const transition = transitionRoom(state, {
            type: "selection.set",
            actorPlayerId: HOST_ID,
            expectedRoomRevision: 99,
            selection,
            nowMs: 2_000,
        });

        reject(transition, "stale-room-revision");
        expect(transition.state).toBe(state);
    });
});

describe("selection and readiness", () => {
    it("restricts selection to the host", () => {
        const state = joinGuest(createRoom());
        reject(transitionRoom(state, actorAction(state, {
            type: "selection.set",
            actorPlayerId: GUEST_ID,
            selection,
            nowMs: 3_000,
        })), "not-host");

    });

    it("increments selection revision and invalidates readiness", () => {
        let state = prepareReadyRoom();
        const previousSelectionRevision = state.selectionRevision;

        state = accept(transitionRoom(state, actorAction(state, {
            type: "selection.set",
            actorPlayerId: HOST_ID,
            selection: { ...selection, chartId: "chart-2" },
            nowMs: 7_000,
        })));

        expect(state.phase).toBe("selecting");
        expect(state.selectionRevision).toBe(previousSelectionRevision + 1);
        expect(state.players.every((player) => !player.ready)).toBe(true);
        expect(
            state.players.every(
                (player) => player.availability.status === "unchecked",
            ),
        ).toBe(true);
    });

    it("rejects stale or mismatching availability", () => {
        let state = createRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "selection.set",
            actorPlayerId: HOST_ID,
            selection,
            nowMs: 2_000,
        })));

        reject(transitionRoom(state, actorAction(state, {
            type: "player.availability",
            actorPlayerId: HOST_ID,
            availability: {
                ...matchingAvailability(state),
                selectionRevision: state.selectionRevision - 1,
            },
            nowMs: 3_000,
        })), "stale-selection-revision");

        reject(transitionRoom(state, actorAction(state, {
            type: "player.availability",
            actorPlayerId: HOST_ID,
            availability: {
                ...matchingAvailability(state),
                chartHash:
                    `${CHART_IDENTITY_VERSION}:${"b".repeat(64)}`,
            },
            nowMs: 3_000,
        })), "chart-not-matched");
    });

    it("requires chart and audio readiness", () => {
        let state = createRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "selection.set",
            actorPlayerId: HOST_ID,
            selection,
            nowMs: 2_000,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.availability",
            actorPlayerId: HOST_ID,
            availability: matchingAvailability(state, false),
            nowMs: 3_000,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "readyCheck.begin",
            actorPlayerId: HOST_ID,
            nowMs: 4_000,
        })));

        reject(transitionRoom(state, actorAction(state, {
            type: "player.ready",
            actorPlayerId: HOST_ID,
            ready: true,
            nowMs: 5_000,
        })), "audio-not-ready");
    });

    it("supports cancelling ready check and clearing selection", () => {
        let state = prepareReadyRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "readyCheck.cancel",
            actorPlayerId: HOST_ID,
            nowMs: 6_000,
        })));
        expect(state.phase).toBe("selecting");

        const previousSelectionRevision = state.selectionRevision;
        state = accept(transitionRoom(state, actorAction(state, {
            type: "selection.clear",
            actorPlayerId: HOST_ID,
            nowMs: 6_100,
        })));
        expect(state.selection).toBeNull();
        expect(state.selectionRevision).toBe(previousSelectionRevision + 1);
    });
});

describe("countdown and play", () => {
    it("requires every clock to be synchronized", () => {
        let state = prepareReadyRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.clockQuality",
            actorPlayerId: GUEST_ID,
            usable: false,
            nowMs: 6_000,
        })));

        reject(transitionRoom(state, actorAction(state, {
            type: "countdown.request",
            actorPlayerId: HOST_ID,
            nowMs: 6_100,
        })), "clock-not-synchronized");
    });

    it("schedules five seconds ahead and starts after acknowledgements", () => {
        const state = startPlaying();
        expect(state.phase).toBe("playing");
        expect(state.startSchedule?.startAtServerMs).toBe(11_000);
    });

    it("cancels countdown when a player disconnects", () => {
        let state = prepareReadyRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "countdown.request",
            actorPlayerId: HOST_ID,
            nowMs: 6_000,
        })));
        state = accept(transitionRoom(state, {
            type: "player.disconnect",
            playerId: GUEST_ID,
            nowMs: 6_500,
        }));

        expect(state.phase).toBe("ready-check");
        expect(state.startSchedule).toBeNull();
        expect(state.players.every((player) => !player.ready)).toBe(true);
    });

    it("rejects joining once countdown begins", () => {
        let state = prepareReadyRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "countdown.request",
            actorPlayerId: HOST_ID,
            nowMs: 6_000,
        })));

        reject(transitionRoom(state, {
            type: "player.join",
            playerId: "late",
            displayName: "Late",
            nowMs: 6_100,
        }), "game-in-progress");
    });

    it("lets the host cancel and lets any player report scheduling failure", () => {
        let state = prepareReadyRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "countdown.request",
            actorPlayerId: HOST_ID,
            nowMs: 6_000,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "countdown.cancel",
            actorPlayerId: HOST_ID,
            nowMs: 6_100,
        })));
        expect(state.phase).toBe("ready-check");

        for (const playerId of [HOST_ID, GUEST_ID]) {
            state = accept(transitionRoom(state, actorAction(state, {
                type: "player.ready",
                actorPlayerId: playerId,
                ready: true,
                nowMs: 6_150,
            })));
        }
        state = accept(transitionRoom(state, actorAction(state, {
            type: "countdown.request",
            actorPlayerId: HOST_ID,
            nowMs: 6_200,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "countdown.failed",
            actorPlayerId: GUEST_ID,
            nowMs: 6_300,
        })));
        expect(state.phase).toBe("ready-check");
    });

    it("returns to ready check when the start deadline lacks acknowledgements", () => {
        let state = prepareReadyRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "countdown.request",
            actorPlayerId: HOST_ID,
            nowMs: 6_000,
        })));
        state = accept(transitionRoom(state, {
            type: "server.tick",
            nowMs: 6_000 + COUNTDOWN_DURATION_MS,
        }));
        expect(state.phase).toBe("ready-check");
    });
});

describe("scores and results", () => {
    it("accepts increasing scores and rejects regressions", () => {
        let state = startPlaying();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "game.score",
            actorPlayerId: HOST_ID,
            score: score(state, 1, 1_000),
            nowMs: 12_000,
        })));

        reject(transitionRoom(state, actorAction(state, {
            type: "game.score",
            actorPlayerId: HOST_ID,
            score: score(state, 2, 500),
            nowMs: 12_100,
        })), "score-regressed");

        reject(transitionRoom(state, actorAction(state, {
            type: "game.score",
            actorPlayerId: HOST_ID,
            score: score(state, 2, 100_001),
            nowMs: 12_100,
        })), "score-regressed");
    });

    it("enters results after every connected player finishes", () => {
        let state = startPlaying();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "game.finished",
            actorPlayerId: HOST_ID,
            result: result(state, 10, 10_000, 130_000),
            nowMs: 130_000,
        })));
        expect(state.phase).toBe("playing");

        state = accept(transitionRoom(state, actorAction(state, {
            type: "game.finished",
            actorPlayerId: GUEST_ID,
            result: result(state, 9, 9_000, 131_000),
            nowMs: 131_000,
        })));
        expect(state.phase).toBe("results");
        expect(state.results).toHaveLength(2);
        expect(state.players.find((player) => player.playerId === HOST_ID)?.winCount).toBe(1);
        expect(state.players.find((player) => player.playerId === GUEST_ID)?.winCount).toBe(0);
        const parsedResponse = serverMessageSchema.safeParse({
            protocolVersion: 1,
            type: "command.accepted",
            commandId: "finished-command",
            roomRevision: state.revision,
            room: state,
        });
        expect(parsedResponse.success).toBe(true);
    });

    it("accepts an identical final-result retry without duplicating standings", () => {
        let state = startPlaying();
        const hostResult = result(state, 10, 10_000, 130_000);
        state = accept(transitionRoom(state, actorAction(state, {
            type: "game.finished",
            actorPlayerId: HOST_ID,
            result: hostResult,
            nowMs: 130_000,
        })));

        const retried = transitionRoom(state, actorAction(state, {
            type: "game.finished",
            actorPlayerId: HOST_ID,
            result: hostResult,
            nowMs: 130_250,
        }));

        expect(retried.accepted).toBe(true);
        if (!retried.accepted) throw new Error("Expected retry acceptance.");
        expect(retried.state).toBe(state);
        expect(retried.state.results).toHaveLength(1);
    });

    it("accepts an identical retry after the room has entered results", () => {
        let state = startPlaying();
        const hostResult = result(state, 10, 10_000, 130_000);
        const guestResult = result(state, 9, 9_000, 131_000);
        state = accept(transitionRoom(state, actorAction(state, {
            type: "game.finished",
            actorPlayerId: HOST_ID,
            result: hostResult,
            nowMs: 130_000,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "game.finished",
            actorPlayerId: GUEST_ID,
            result: guestResult,
            nowMs: 131_000,
        })));
        expect(state.phase).toBe("results");

        const retried = transitionRoom(state, actorAction(state, {
            type: "game.finished",
            actorPlayerId: GUEST_ID,
            result: guestResult,
            nowMs: 131_250,
        }));

        expect(retried.accepted).toBe(true);
        if (!retried.accepted) throw new Error("Expected retry acceptance.");
        expect(retried.state.results).toHaveLength(2);
    });

    it("lets only the host replay and preserves the selection", () => {
        let state = startPlaying();
        for (const [playerId, points] of [
            [HOST_ID, 10_000],
            [GUEST_ID, 9_000],
        ] as const) {
            state = accept(transitionRoom(state, actorAction(state, {
                type: "game.finished",
                actorPlayerId: playerId,
                result: result(state, 10, points, 130_000),
                nowMs: 130_000,
            })));
        }

        reject(transitionRoom(state, actorAction(state, {
            type: "results.replay",
            actorPlayerId: GUEST_ID,
            nowMs: 132_000,
        })), "not-host");

        for (const playerId of [HOST_ID, GUEST_ID]) {
            state = accept(transitionRoom(state, actorAction(state, {
                type: "results.replayVote",
                actorPlayerId: playerId,
                wantsReplay: true,
                nowMs: 131_500,
            })));
        }

        const chartHash = state.selection?.chartHash;
        state = accept(transitionRoom(state, actorAction(state, {
            type: "results.replay",
            actorPlayerId: HOST_ID,
            nowMs: 132_000,
        })));

        expect(state.phase).toBe("ready-check");
        expect(state.selection?.chartHash).toBe(chartHash);
        expect(state.players.every((player) => !player.ready)).toBe(true);
        expect(state.results).toEqual([]);
        expect(state.players.find((player) => player.playerId === HOST_ID)?.winCount).toBe(1);
    });

    it("enters results at the result deadline and returns to selection", () => {
        let state = startPlaying();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "game.finished",
            actorPlayerId: HOST_ID,
            result: result(state, 10, 10_000, 130_000),
            nowMs: 130_000,
        })));
        expect(state.resultsDeadlineAtServerMs).toBe(145_000);

        state = accept(transitionRoom(state, {
            type: "server.tick",
            nowMs: 145_000,
        }));
        expect(state.phase).toBe("results");

        state = accept(transitionRoom(state, actorAction(state, {
            type: "results.returnToSelection",
            actorPlayerId: HOST_ID,
            nowMs: 145_100,
        })));
        expect(state.phase).toBe("selecting");
        expect(state.selection).toBeNull();
        expect(state.results).toEqual([]);
    });
});

describe("host moderation", () => {
    it("lets the host kick a guest while preserving the room", () => {
        let state = joinGuest(createRoom());
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.kick",
            actorPlayerId: HOST_ID,
            playerId: GUEST_ID,
            nowMs: 3_000,
        })));
        expect(state.players.map((player) => player.playerId)).toEqual([HOST_ID]);
        expect(state.phase).toBe("selecting");
    });

    it("rejects guest kicks and kicking during gameplay", () => {
        const lobby = joinGuest(createRoom());
        reject(transitionRoom(lobby, actorAction(lobby, {
            type: "player.kick",
            actorPlayerId: GUEST_ID,
            playerId: HOST_ID,
            nowMs: 3_000,
        })), "not-host");

        const playing = startPlaying();
        reject(transitionRoom(playing, actorAction(playing, {
            type: "player.kick",
            actorPlayerId: HOST_ID,
            playerId: GUEST_ID,
            nowMs: 12_000,
        })), "invalid-phase");
    });
});

describe("shared preview state", () => {
    const preview = {
        assetProtocolVersion: ASSET_PROTOCOL_VERSION,
        songId: "song-1",
        title: "Test Song",
        subtitle: "",
        artist: "Test Artist",
        artwork: null,
        audioPreview: null,
        previewDurationSeconds: 12,
    };

    it("lets the host publish and clear increasing preview revisions", () => {
        let state = createRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "preview.publish",
            actorPlayerId: HOST_ID,
            preview,
            nowMs: 2_000,
        })));
        expect(state.preview).toMatchObject({ previewRevision: 1, publishedByPlayerId: HOST_ID });
        state = accept(transitionRoom(state, actorAction(state, {
            type: "preview.clear",
            actorPlayerId: HOST_ID,
            nowMs: 2_100,
        })));
        expect(state.preview).toBeNull();
        expect(state.previewRevision).toBe(2);
    });

    it("rejects guest preview publication", () => {
        const state = joinGuest(createRoom());
        reject(transitionRoom(state, actorAction(state, {
            type: "preview.publish",
            actorPlayerId: GUEST_ID,
            preview,
            nowMs: 3_000,
        })), "not-host");
    });
});

describe("shared song package and per-player difficulty", () => {
    const sha = (character: string) => `sha256:${character.repeat(64)}` as const;
    const packageProposal = {
        assetProtocolVersion: ASSET_PROTOCOL_VERSION,
        packageId: "package-1",
        songId: "song-1",
        title: "Test Song",
        subtitle: "",
        artist: "Test Artist",
        artwork: null,
        audio: {
            assetId: "song_audio_asset_123456", kind: "song-audio" as const,
            mimeType: "audio/ogg", byteLength: 1024, sha256: sha("a"), expiresAtServerMs: 50_000,
        },
        chartPackage: {
            assetId: "chart_package_asset_123456", kind: "chart-package" as const,
            mimeType: "application/json" as const, byteLength: 512, sha256: sha("b"), expiresAtServerMs: 50_000,
        },
        charts: [{
            chartId: "chart-easy", chartHash: `${CHART_IDENTITY_VERSION}:${"c".repeat(64)}`,
            stepType: "dance-single" as const, description: "", difficulty: "Easy",
            meter: 3, tapCount: 50, durationSeconds: 90,
        }, {
            chartId: "chart-hard", chartHash: `${CHART_IDENTITY_VERSION}:${"d".repeat(64)}`,
            stepType: "dance-single" as const, description: "", difficulty: "Hard",
            meter: 8, tapCount: 120, durationSeconds: 90,
        }],
    };

    it("lets the host confirm a song and each player choose independently", () => {
        let state = joinGuest(createRoom());
        state = accept(transitionRoom(state, actorAction(state, {
            type: "songPackage.commit", actorPlayerId: HOST_ID,
            songPackage: packageProposal, nowMs: 3_000,
        })));
        expect(state.songPackage?.charts).toHaveLength(2);
        expect(state.selection).toBeNull();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.chart.select", actorPlayerId: HOST_ID,
            choice: { selectionRevision: state.selectionRevision, chartId: "chart-hard", chartHash: packageProposal.charts[1]!.chartHash }, nowMs: 3_100,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.chart.select", actorPlayerId: GUEST_ID,
            choice: { selectionRevision: state.selectionRevision, chartId: "chart-easy", chartHash: packageProposal.charts[0]!.chartHash }, nowMs: 3_200,
        })));
        expect(state.players.find((player) => player.playerId === HOST_ID)?.chartChoice?.chartId).toBe("chart-hard");
        expect(state.players.find((player) => player.playerId === GUEST_ID)?.chartChoice?.chartId).toBe("chart-easy");
    });

    it("rejects a chart that is not in the current package", () => {
        let state = createRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "songPackage.commit", actorPlayerId: HOST_ID, songPackage: packageProposal, nowMs: 2_000,
        })));
        reject(transitionRoom(state, actorAction(state, {
            type: "player.chart.select", actorPlayerId: HOST_ID,
            choice: { selectionRevision: state.selectionRevision, chartId: "unknown", chartHash: packageProposal.charts[0]!.chartHash }, nowMs: 2_100,
        })), "chart-not-matched");
    });

    it("requires verified audio and a chart choice before readying", () => {
        let state = createRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "songPackage.commit", actorPlayerId: HOST_ID, songPackage: packageProposal, nowMs: 2_000,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.chart.select", actorPlayerId: HOST_ID,
            choice: { selectionRevision: state.selectionRevision, chartId: "chart-easy", chartHash: packageProposal.charts[0]!.chartHash }, nowMs: 2_100,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.asset.status", actorPlayerId: HOST_ID,
            preparation: { selectionRevision: state.selectionRevision, status: "prepared", bytesReceived: 1536,
                totalBytes: 1536, verifiedAudioHash: packageProposal.audio.sha256, errorCode: null }, nowMs: 2_200,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.ready", actorPlayerId: HOST_ID, ready: true, nowMs: 2_400,
        })));
        expect(state.players[0]?.ready).toBe(true);
    });

    it("accepts a final result for a per-player package chart", () => {
        let state = createRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "songPackage.commit", actorPlayerId: HOST_ID, songPackage: packageProposal, nowMs: 2_000,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.chart.select", actorPlayerId: HOST_ID,
            choice: { selectionRevision: state.selectionRevision, chartId: "chart-easy", chartHash: packageProposal.charts[0]!.chartHash }, nowMs: 2_100,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.asset.status", actorPlayerId: HOST_ID,
            preparation: { selectionRevision: state.selectionRevision, status: "prepared", bytesReceived: 1536,
                totalBytes: 1536, verifiedAudioHash: packageProposal.audio.sha256, errorCode: null }, nowMs: 2_200,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.clockQuality", actorPlayerId: HOST_ID, usable: true, nowMs: 2_300,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.ready", actorPlayerId: HOST_ID, ready: true, nowMs: 2_400,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "countdown.request", actorPlayerId: HOST_ID, nowMs: 3_000,
        })));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "countdown.scheduled", actorPlayerId: HOST_ID, nowMs: 3_100,
        })));
        state = accept(transitionRoom(state, { type: "server.tick", nowMs: state.startSchedule!.startAtServerMs }));
        state = accept(transitionRoom(state, actorAction(state, {
            type: "game.finished", actorPlayerId: HOST_ID,
            result: result(state, 1, 1_000, 100_000), nowMs: 100_000,
        })));
        expect(state.phase).toBe("results");
        expect(state.results).toHaveLength(1);
    });
});

describe("disconnect and room lifecycle", () => {
    it("resumes the same player inside the grace window", () => {
        let state = joinGuest(createRoom());
        state = accept(transitionRoom(state, {
            type: "player.disconnect",
            playerId: GUEST_ID,
            nowMs: 3_000,
        }));
        state = accept(transitionRoom(state, {
            type: "player.resume",
            playerId: GUEST_ID,
            nowMs: 3_000 + RECONNECT_GRACE_MS,
        }));

        expect(
            state.players.find((player) => player.playerId === GUEST_ID)
                ?.connectionStatus,
        ).toBe("connected");
    });

    it("transfers host after the reconnect grace expires", () => {
        let state = joinGuest(createRoom());
        state = accept(transitionRoom(state, {
            type: "player.disconnect",
            playerId: HOST_ID,
            nowMs: 3_000,
        }));
        state = accept(transitionRoom(state, {
            type: "server.tick",
            nowMs: 3_000 + RECONNECT_GRACE_MS + 1,
        }));

        expect(state.hostPlayerId).toBe(GUEST_ID);
        expect(state.players.map((player) => player.playerId)).toEqual([
            GUEST_ID,
        ]);
    });

    it("expires an inactive lobby and closes an empty room", () => {
        let state = createRoom();
        state = accept(transitionRoom(state, {
            type: "server.tick",
            nowMs: 1_000 + ROOM_INACTIVITY_MS,
        }));
        expect(state.phase).toBe("closed");
        expect(state.closeReason).toBe("room-expired");

        state = createRoom();
        state = accept(transitionRoom(state, actorAction(state, {
            type: "player.leave",
            actorPlayerId: HOST_ID,
            nowMs: 2_000,
        })));
        expect(state.phase).toBe("closed");
        expect(state.closeReason).toBe("room-empty");
    });

    it("lets only the host close the room", () => {
        let state = joinGuest(createRoom());
        reject(transitionRoom(state, actorAction(state, {
            type: "room.close",
            actorPlayerId: GUEST_ID,
            nowMs: 3_000,
        })), "not-host");

        state = accept(transitionRoom(state, actorAction(state, {
            type: "room.close",
            actorPlayerId: HOST_ID,
            nowMs: 3_100,
        })));
        expect(state.phase).toBe("closed");
        expect(state.closeReason).toBe("host-closed");
    });
});
