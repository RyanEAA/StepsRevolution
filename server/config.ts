export interface ServerConfig {
    host: string;
    port: number;
    allowedOrigins: string[];
    relayTempDirectory: string | undefined;
    relayRoomQuotaBytes: number;
    relayAssetTtlMs: number;
}

const DEFAULT_RELAY_ASSET_TTL_MINUTES = 30;
const DEFAULT_HOST =
    process.env.DYNO
        ? "0.0.0.0"
        : "127.0.0.1";
const DEFAULT_PORT = 3001;
const DEFAULT_RELAY_ROOM_QUOTA_MB = 200;



export function loadServerConfig(
    environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
    const parsedPort = Number.parseInt(
        environment.PORT ?? "",
        10,
    );

    const parsedAssetTtlMinutes = Number.parseInt(
        environment.RELAY_ASSET_TTL_MINUTES ?? "",
        10,
    );

    const allowedOrigins = (
        environment.CLIENT_ORIGINS ??
        "http://localhost:5173,http://127.0.0.1:5173"
    )
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
    const parsedQuotaMb = Number.parseInt(
        environment.RELAY_ROOM_QUOTA_MB ?? "",
        10,
    );

    return {
        host:
            environment.HOST?.trim() ||
            DEFAULT_HOST,
        port:
            Number.isInteger(parsedPort) &&
                parsedPort >= 0 &&
                parsedPort <= 65_535
                ? parsedPort
                : DEFAULT_PORT,
        allowedOrigins,
        relayTempDirectory:
            environment.RELAY_TEMP_DIR?.trim() || undefined,
        relayRoomQuotaBytes:
            (Number.isInteger(parsedQuotaMb) && parsedQuotaMb > 0
                ? parsedQuotaMb
                : DEFAULT_RELAY_ROOM_QUOTA_MB) * 1024 * 1024,
        relayAssetTtlMs:
            (Number.isInteger(parsedAssetTtlMinutes) &&
                parsedAssetTtlMinutes > 0
                ? parsedAssetTtlMinutes
                : DEFAULT_RELAY_ASSET_TTL_MINUTES) * 60 * 1000,
    };
}
