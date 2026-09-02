import { DanceVisionServer } from "./createDanceVisionServer";
import { loadServerConfig } from "./config";

const config = loadServerConfig();
const server = new DanceVisionServer({
    port: config.port,
    host: config.host,
    allowedOrigins: config.allowedOrigins,
    assetRelayOptions: {
        rootDirectory: config.relayTempDirectory,
        roomQuotaBytes: config.relayRoomQuotaBytes,
        assetTtlMs: config.relayAssetTtlMs,
    },
});

const url = await server.start();
console.log(`Visince room server listening at ${url}`);

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
