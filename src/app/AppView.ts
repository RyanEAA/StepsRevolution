export const APP_VIEWS = [
    "library-import",
    "pack-selection",
    "song-selection",
    "gameplay",
    "results",
] as const;

export type AppView = (typeof APP_VIEWS)[number];