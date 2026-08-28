export const APP_VIEWS = [
    "main-menu",
    "settings",
    "calibration",
    "library-import",
    "pack-selection",
    "song-selection",
    "multiplayer-lobby",
    "gameplay",
    "results",
] as const;

export type AppView = (typeof APP_VIEWS)[number];
