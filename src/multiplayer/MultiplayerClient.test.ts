import { afterEach, describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "../../shared/constants";
import { DanceVisionServer } from "../../server/createDanceVisionServer";
import { MultiplayerClient } from "./MultiplayerClient";

let server: DanceVisionServer | null = null;
let client: MultiplayerClient | null = null;

afterEach(async () => {
    client?.destroy();
    client = null;
    await server?.stop();
    server = null;
});

describe("MultiplayerClient", () => {
    it("connects to the room server and validates command responses", async () => {
        server = new DanceVisionServer({ port: 0 });
        const url = await server.start();
        client = new MultiplayerClient({ serverUrl: url });
        const states: string[] = [];
        client.subscribeConnection((state) => states.push(state));

        await client.connect();
        const response = await client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "room.create",
            commandId: "create-client-test",
            payload: { displayName: "Host" },
        });

        expect(response.type).toBe("room.created");
        expect(states).toContain("connecting");
        expect(states.at(-1)).toBe("connected");
    });

    it("rejects commands before connecting", async () => {
        client = new MultiplayerClient({
            serverUrl: "http://127.0.0.1:1",
        });

        await expect(client.send({
            protocolVersion: PROTOCOL_VERSION,
            type: "room.create",
            commandId: "not-connected",
            payload: { displayName: "Host" },
        })).rejects.toMatchObject({ code: "not-connected" });
    });
});
