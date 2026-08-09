export type GameplaySessionKind = "local" | "online";

export interface GameplayControlPolicy {
    immediateStart: boolean;
    localPause: boolean;
    localRestart: boolean;
    localReplay: boolean;
}

export interface GameplaySession {
    readonly kind: GameplaySessionKind;
    readonly controlPolicy: GameplayControlPolicy;
}
