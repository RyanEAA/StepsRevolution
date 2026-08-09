import type { GameplaySession } from "./GameplaySession";
import type { LocalSession } from "./LocalSession";

export class SessionManager {
    private activeSession: GameplaySession;
    private readonly localSession: LocalSession;

    public constructor(localSession: LocalSession) {
        this.localSession = localSession;
        this.activeSession = localSession;
    }

    public getActiveSession(): GameplaySession {
        return this.activeSession;
    }

    public useLocalSession(): void {
        this.activeSession = this.localSession;
    }

    public useOnlineSession(session: GameplaySession): void {
        if (session.kind !== "online") {
            throw new Error(
                "Only an online session can replace the local session.",
            );
        }

        this.activeSession = session;
    }
}
