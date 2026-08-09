import { describe, expect, it } from "vitest";

import type { GameplaySession } from "./GameplaySession";
import { LocalSession } from "./LocalSession";
import { SessionManager } from "./SessionManager";

describe("SessionManager", () => {
    it("uses a fully enabled local session by default", () => {
        const manager = new SessionManager(new LocalSession());

        expect(manager.getActiveSession().kind).toBe("local");
        expect(manager.getActiveSession().controlPolicy).toEqual({
            immediateStart: true,
            localPause: true,
            localRestart: true,
            localReplay: true,
        });
    });

    it("switches between online and local control policies", () => {
        const local = new LocalSession();
        const manager = new SessionManager(local);
        const online: GameplaySession = {
            kind: "online",
            controlPolicy: {
                immediateStart: false,
                localPause: false,
                localRestart: false,
                localReplay: false,
            },
        };

        manager.useOnlineSession(online);
        expect(manager.getActiveSession()).toBe(online);

        manager.useLocalSession();
        expect(manager.getActiveSession()).toBe(local);
    });
});
