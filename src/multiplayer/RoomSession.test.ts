import { afterEach, describe, expect, it } from "vitest";

import { DanceVisionServer } from "../../server/createDanceVisionServer";
import { CHART_IDENTITY_VERSION } from "../../shared/constants";
import { MultiplayerClient } from "./MultiplayerClient";
import { ReconnectCredentialStore } from "./ReconnectCredentialStore";
import { RoomSession } from "./RoomSession";

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();
    public get length(): number { return this.values.size; }
    public clear(): void { this.values.clear(); }
    public getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }
    public key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }
    public removeItem(key: string): void { this.values.delete(key); }
    public setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}

let server: DanceVisionServer | null = null;
let session: RoomSession | null = null;

afterEach(async () => {
    session?.destroy();
    session = null;
    await server?.stop();
    server = null;
});

describe("RoomSession", () => {
    it("owns canonical room state and persists reconnect identity", async () => {
        server = new DanceVisionServer({ port: 0 });
        const url = await server.start();
        const storage = new MemoryStorage();
        session = new RoomSession({
            client: new MultiplayerClient({ serverUrl: url }),
            credentialStore: new ReconnectCredentialStore(storage),
            createCommandId: () => crypto.randomUUID(),
        });

        const room = await session.createRoom("Host");

        expect(session.getState().room).toEqual(room);
        expect(session.getState().localPlayerId)
            .toBe(room.hostPlayerId);
        expect(storage.length).toBe(1);
        expect(session.controlPolicy.localPause).toBe(false);

        await session.setSelection({
            songId: "song-1",
            chartId: "chart-1",
            chartHash: `${CHART_IDENTITY_VERSION}:${"a".repeat(64)}`,
            identityVersion: CHART_IDENTITY_VERSION,
            title: "Test Song",
            subtitle: "",
            artist: "Test Artist",
            stepType: "dance-single",
            difficulty: "Hard",
            meter: 9,
            tapCount: 100,
            durationSeconds: 90,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(session.getState().room?.selection?.title)
            .toBe("Test Song");
        expect(session.getState().room?.selectionRevision).toBe(1);

        await session.reportAvailability({
            status: "matching-chart",
            selectionRevision: 1,
            chartHash: `${CHART_IDENTITY_VERSION}:${"a".repeat(64)}`,
            audioReady: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await session.beginReadyCheck();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await session.setReady(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(session.getState().room?.phase).toBe("ready-check");
        expect(session.getState().room?.players[0]?.ready).toBe(true);

        await session.leaveRoom();
        expect(session.getState().room).toBeNull();
        expect(storage.length).toBe(0);
    });

    it("resumes a stored identity after a new client is created", async () => {
        server = new DanceVisionServer({ port: 0 });
        const url = await server.start();
        const storage = new MemoryStorage();
        const first = new RoomSession({
            client: new MultiplayerClient({ serverUrl: url }),
            credentialStore: new ReconnectCredentialStore(storage),
        });
        const created = await first.createRoom("Host");
        first.destroy();

        session = new RoomSession({
            client: new MultiplayerClient({ serverUrl: url }),
            credentialStore: new ReconnectCredentialStore(storage),
        });
        const resumed = await session.connect(true);

        expect(resumed).toBeUndefined();
        expect(session.getState().room?.roomId).toBe(created.roomId);
        expect(session.getState().localPlayerId).toBe(created.hostPlayerId);
    });
});
