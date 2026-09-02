import { describe, expect, it, vi } from "vitest";

import type { AppView } from "../app/AppView";
import type { RoomSessionState } from "../multiplayer/RoomSession";
import type { GameplaySession } from "../session/GameplaySession";
import type { ProposedRoomSelection } from "../multiplayer/RoomSession";
import type { Availability } from "../../shared/schemas";
import type { StepManiaChart } from "../types/Chart";
import type { SongEntry } from "../types/Library";
import type { LocalChartAvailability } from "../library/ChartAvailabilityIndex";
import type { MultiplayerViewCallbacks } from "../ui/MultiplayerView";
import {
    MultiplayerController,
    type MultiplayerRoomSessionPort,
    type MultiplayerSessionManagerPort,
    type MultiplayerViewPort,
} from "./MultiplayerController";

const policy = {
    immediateStart: false,
    localPause: false,
    localRestart: false,
    localReplay: false,
};

class FakeRoomSession implements MultiplayerRoomSessionPort {
    public readonly kind = "online" as const;
    public readonly controlPolicy = policy;
    public state: RoomSessionState = {
        connectionState: "offline",
        room: null,
        localPlayerId: null,
        lastError: null,
    };
    public createdName = "";
    public joined: [string, string] | null = null;
    public left = false;
    public disconnected = false;
    public selection: ProposedRoomSelection | null = null;
    public availability: Availability | null = null;
    public ready = false;
    public cancelReadyCheckCalls = 0;
    public clearSelectionCalls = 0;
    public getState(): Readonly<RoomSessionState> { return this.state; }
    public subscribe(listener: (state: Readonly<RoomSessionState>) => void): () => void {
        listener(this.state);
        return () => undefined;
    }
    public async createRoom(displayName: string): Promise<void> {
        this.createdName = displayName;
    }
    public async joinRoom(roomCode: string, displayName: string): Promise<void> {
        this.joined = [roomCode, displayName];
    }
    public async leaveRoom(): Promise<void> { this.left = true; }
    public disconnect(): void { this.disconnected = true; }
    public async setSelection(selection: ProposedRoomSelection): Promise<void> {
        this.selection = selection;
    }
    public async clearSelection(): Promise<void> {
        this.clearSelectionCalls += 1;
        if (this.state.room) {
            this.state = {
                ...this.state,
                room: {
                    ...this.state.room,
                    phase: "selecting",
                    selection: null,
                    songPackage: null,
                },
            };
        }
    }
    public async reportAvailability(availability: Availability): Promise<void> {
        this.availability = availability;
    }
    public async setReady(ready: boolean): Promise<void> { this.ready = ready; }
    public async beginReadyCheck(): Promise<void> {}
    public async cancelReadyCheck(): Promise<void> { this.cancelReadyCheckCalls += 1; }
    public async kickPlayer(): Promise<void> {}
}

class FakeSessionManager implements MultiplayerSessionManagerPort {
    private readonly local: GameplaySession = {
        kind: "local",
        controlPolicy: { ...policy, immediateStart: true },
    };
    public active: GameplaySession = this.local;
    public getActiveSession(): GameplaySession { return this.active; }
    public useLocalSession(): void { this.active = this.local; }
    public useOnlineSession(session: GameplaySession): void { this.active = session; }
}

class FakeView implements MultiplayerViewPort {
    public callbacks: MultiplayerViewCallbacks | null = null;
    public status = "";
    public pending = false;
    public initialize(callbacks: MultiplayerViewCallbacks): void { this.callbacks = callbacks; }
    public destroy(): void { this.callbacks = null; }
    public showHostForm(): void {}
    public showJoinForm(): void {}
    public hideForms(): void {}
    public setPending(pending: boolean, message?: string): void {
        this.pending = pending;
        if (message !== undefined) this.status = message;
    }
    public setStatus(message: string): void { this.status = message; }
    public setSelectionStatus(message: string): void { this.status = message; }
    public setReadyStatus(message: string): void { this.status = message; }
    public renderSession(): void {}
}

function createHarness(
    checkAvailability?: (
        selection: import("../../shared/schemas").RoomSelection,
    ) => LocalChartAvailability,
) {
    const roomSession = new FakeRoomSession();
    const sessionManager = new FakeSessionManager();
    const view = new FakeView();
    const shown: AppView[] = [];
    const controller = new MultiplayerController({
        roomSession,
        sessionManager,
        view,
        viewManager: { show: (target) => shown.push(target) },
        getSinglePlayerDestination: () => "library-import",
        setRoomSelectionMode: () => undefined,
        checkAvailability: checkAvailability ?? ((selection) => ({
            status: "song-missing",
            selectionRevision: selection.selectionRevision,
            chartHash: null,
            audioReady: false,
            match: null,
        })),
    });
    controller.initialize();
    return { controller, roomSession, sessionManager, view, shown };
}

describe("MultiplayerController", () => {
    it("preserves the local single-player destination", () => {
        const harness = createHarness();

        harness.view.callbacks?.onSinglePlayer();

        expect(harness.sessionManager.active.kind).toBe("local");
        expect(harness.shown.at(-1)).toBe("library-import");
    });

    it("clears the canonical room song before the host changes songs", async () => {
        const roomSelectionModes: boolean[] = [];
        const roomSession = new FakeRoomSession();
        roomSession.state = {
            connectionState: "connected",
            localPlayerId: "host-1",
            lastError: null,
            room: {
                hostPlayerId: "host-1",
                phase: "ready-check",
            } as RoomSessionState["room"],
        };
        const sessionManager = new FakeSessionManager();
        const view = new FakeView();
        const shown: AppView[] = [];
        const controller = new MultiplayerController({
            roomSession,
            sessionManager,
            view,
            viewManager: { show: (target) => shown.push(target) },
            getSinglePlayerDestination: () => "pack-selection",
            setRoomSelectionMode: (enabled) => roomSelectionModes.push(enabled),
            checkAvailability: (selection) => ({
                status: "song-missing",
                selectionRevision: selection.selectionRevision,
                chartHash: null,
                audioReady: false,
                match: null,
            }),
        });
        controller.initialize();

        view.callbacks?.onBrowseHostLibrary();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(roomSession.clearSelectionCalls).toBe(1);
        expect(roomSelectionModes.at(-1)).toBe(true);
        expect(shown.at(-1)).toBe("pack-selection");
    });

    it("returns from the song browser to a clean multiplayer lobby", async () => {
        const harness = createHarness();
        harness.roomSession.state = {
            connectionState: "connected",
            localPlayerId: "host-1",
            lastError: null,
            room: {
                hostPlayerId: "host-1",
                phase: "ready-check",
                selection: null,
                songPackage: { title: "Old song" },
            } as RoomSessionState["room"],
        };

        await harness.controller.returnToLobbyFromSongBrowser();

        expect(harness.roomSession.clearSelectionCalls).toBe(1);
        expect(harness.roomSession.state.room?.phase).toBe("selecting");
        expect(harness.roomSession.state.room?.songPackage).toBeNull();
        expect(harness.shown.at(-1)).toBe("multiplayer-lobby");
    });

    it("creates a room and activates the online lobby", async () => {
        const harness = createHarness();

        harness.view.callbacks?.onHostSubmitted("Ryan");
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(harness.roomSession.createdName).toBe("Ryan");
        expect(harness.sessionManager.active.kind).toBe("online");
        expect(harness.shown.at(-1)).toBe("multiplayer-lobby");
        expect(harness.view.pending).toBe(false);
    });

    it("normalizes join input and returns to the main menu on leave", async () => {
        const harness = createHarness();

        harness.view.callbacks?.onJoinSubmitted("abc234", "Guest");
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(harness.roomSession.joined).toEqual(["ABC234", "Guest"]);

        harness.view.callbacks?.onLeaveRoom();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(harness.roomSession.left).toBe(true);
        expect(harness.roomSession.disconnected).toBe(true);
        expect(harness.sessionManager.active.kind).toBe("local");
        expect(harness.shown.at(-1)).toBe("main-menu");
    });

    it("debounces host chart choices and publishes the latest identity", async () => {
        vi.useFakeTimers();
        try {
            const harness = createHarness();
            harness.roomSession.state = {
                connectionState: "connected",
                localPlayerId: "host-1",
                lastError: null,
                room: {
                    hostPlayerId: "host-1",
                } as RoomSessionState["room"],
            };
            const easy: StepManiaChart = {
                stepType: "dance-single",
                description: "",
                difficulty: "Easy",
                meter: 3,
                radarValues: [],
                notes: [],
            };
            const hard: StepManiaChart = {
                ...easy,
                difficulty: "Hard",
                meter: 9,
            };
            const song = {
                title: "Test Song",
                artist: "Artist",
                simfile: {
                    subtitle: "",
                    charts: [easy, hard],
                },
                chartIdentities: [
                    {
                        chartIndex: 0,
                        state: "available",
                        songId: "song-1",
                        chartId: "easy-1",
                        chartHash: "dance-vision-chart-v1:" + "a".repeat(64),
                        tapCount: 20,
                        durationSeconds: 30,
                    },
                    {
                        chartIndex: 1,
                        state: "available",
                        songId: "song-1",
                        chartId: "hard-1",
                        chartHash: "dance-vision-chart-v1:" + "b".repeat(64),
                        tapCount: 80,
                        durationSeconds: 40,
                    },
                ],
            } as unknown as SongEntry;

            harness.controller.selectChartForRoom(song, easy);
            harness.controller.selectChartForRoom(song, hard);
            await vi.advanceTimersByTimeAsync(250);

            expect(harness.roomSession.selection?.chartId).toBe("hard-1");
            expect(harness.roomSession.selection?.meter).toBe(9);
        } finally {
            vi.useRealTimers();
        }
    });

    it("reports an exact local match for the canonical selection revision", async () => {
        const harness = createHarness((selection) => ({
            status: "matching-chart",
            selectionRevision: selection.selectionRevision,
            chartHash: selection.chartHash,
            audioReady: true,
            match: null,
        }));
        const canonicalSelection = {
            selectionRevision: 4,
            chartHash: "dance-vision-chart-v1:" + "c".repeat(64),
        } as import("../../shared/schemas").RoomSelection;
        harness.roomSession.state = {
            connectionState: "connected",
            localPlayerId: "guest-1",
            lastError: null,
            room: {
                selection: canonicalSelection,
                players: [{
                    playerId: "guest-1",
                    availability: {
                        status: "unchecked",
                        selectionRevision: null,
                        chartHash: null,
                        audioReady: false,
                    },
                }],
            } as unknown as NonNullable<RoomSessionState["room"]>,
        };

        harness.controller.handleLibraryChanged();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(harness.roomSession.availability).toEqual({
            status: "matching-chart",
            selectionRevision: 4,
            chartHash: canonicalSelection.chartHash,
            audioReady: true,
        });
    });
});
