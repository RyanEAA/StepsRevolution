import { describe, expect, it } from "vitest";

import { Game } from "./Game";

describe("Game audio-end completion", () => {
  it("finishes and judges every remaining note as missed", () => {
    const game = new Game();
    game.loadChart([
      { lane: 0, hitTimeSeconds: 1 },
      { lane: 3, hitTimeSeconds: 2 },
    ]);
    game.start();

    game.completeAfterAudioEnd();

    expect(game.getState().status).toBe("finished");
    expect(game.getState().notes).toHaveLength(0);
    expect(game.getState().score.missCount).toBe(2);
    expect(game.getState().gameTimeSeconds).toBe(3);
  });

  it("does not change an idle game", () => {
    const game = new Game();
    game.loadChart([{ lane: 1, hitTimeSeconds: 1 }]);

    game.completeAfterAudioEnd();

    expect(game.getState().status).toBe("idle");
  });
});
