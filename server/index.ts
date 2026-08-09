import { DanceVisionServer } from "./createDanceVisionServer";
import { loadServerConfig } from "./config";

const config = loadServerConfig();
const server = new DanceVisionServer({
    port: config.port,
    host: "0.0.0.0",
    allowedOrigins: config.allowedOrigins,
    assetRelayOptions: {
        rootDirectory: config.relayTempDirectory,
        roomQuotaBytes: config.relayRoomQuotaBytes,
    },
});

const url = await server.start();
console.log(`Dance Vision room server listening at ${url}`);

let stopping = false;

async function stop(): Promise<void> {
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
