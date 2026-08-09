import type {
    GameplayControlPolicy,
    GameplaySession,
} from "./GameplaySession";

const LOCAL_CONTROL_POLICY: GameplayControlPolicy = {
    immediateStart: true,
    localPause: true,
    localRestart: true,
    localReplay: true,
};

export class LocalSession implements GameplaySession {
    public readonly kind = "local" as const;
    public readonly controlPolicy = LOCAL_CONTROL_POLICY;
}
