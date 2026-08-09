import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "../../shared/constants";
import { ReconnectCredentialStore } from "./ReconnectCredentialStore";

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

const credentials = {
    roomId: "room-1",
    playerId: "player-1",
    reconnectToken: "a".repeat(64),
};

describe("ReconnectCredentialStore", () => {
    it("round-trips protocol-versioned session credentials", () => {
        const store = new ReconnectCredentialStore(new MemoryStorage());

        store.save(credentials);

        expect(store.load()).toEqual(credentials);
    });

    it("clears invalid or incompatible stored data", () => {
        const storage = new MemoryStorage();
        storage.setItem(
            "dance-vision.multiplayer-session.v1",
            JSON.stringify({
                protocolVersion: PROTOCOL_VERSION + 1,
                ...credentials,
            }),
        );
        const store = new ReconnectCredentialStore(storage);

        expect(store.load()).toBeNull();
        expect(storage.length).toBe(0);
    });
});
