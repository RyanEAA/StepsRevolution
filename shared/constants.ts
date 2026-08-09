export const PROTOCOL_VERSION = 1 as const;

export const CHART_IDENTITY_VERSION =
    "dance-vision-runtime-chart-v1" as const;

export const SONG_IDENTITY_VERSION =
    "dance-vision-song-v1" as const;

export const CHART_SLOT_IDENTITY_VERSION =
    "dance-vision-chart-slot-v1" as const;

export const MAX_ROOM_PLAYERS = 4;
export const COUNTDOWN_DURATION_MS = 5_000;
export const RECONNECT_GRACE_MS = 20_000;
export const ROOM_INACTIVITY_MS = 30 * 60_000;
export const SCORE_UPDATE_INTERVAL_MS = 100;
export const SCORE_HEARTBEAT_INTERVAL_MS = 1_000;
