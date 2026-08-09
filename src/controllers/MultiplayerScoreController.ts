import {
  SCORE_HEARTBEAT_INTERVAL_MS,
  SCORE_UPDATE_INTERVAL_MS,
} from "../../shared/constants";
import type { LiveScore } from "../../shared/schemas";
import type { Game } from "../game/Game";
import type { RoomSession } from "../multiplayer/RoomSession";

export class MultiplayerScoreController {
  private readonly roomSession: RoomSession;
  private readonly game: Game;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;
  private selectionRevision: number | null = null;
  private lastSignature = "";
  private lastSentAtMs = 0;
  private inFlight = false;

  public constructor(
    roomSession: RoomSession,
    game: Game,
  ) {
    this.roomSession = roomSession;
    this.game = game;
  }

  public initialize(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.publishIfNeeded();
    }, SCORE_UPDATE_INTERVAL_MS);
  }

  public destroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  public nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private async publishIfNeeded(): Promise<void> {
    const session = this.roomSession.getState();
    const room = session.room;
    const gameState = this.game.getState();

    if (!room || room.phase !== "playing" || !session.localPlayerId) {
      this.resetForInactiveRoom();
      return;
    }

    if (this.selectionRevision !== room.selectionRevision) {
      this.selectionRevision = room.selectionRevision;
      this.sequence = 0;
      this.lastSignature = "";
      this.lastSentAtMs = 0;
    }

    if (gameState.status !== "playing" || this.inFlight) return;

    const signature = [
      gameState.score.score,
      gameState.score.combo,
      gameState.score.maxCombo,
      gameState.score.perfectCount,
      gameState.score.greatCount,
      gameState.score.goodCount,
      gameState.score.missCount,
    ].join(":");
    const nowMs = performance.now();
    if (
      signature === this.lastSignature &&
      nowMs - this.lastSentAtMs < SCORE_HEARTBEAT_INTERVAL_MS
    ) return;

    const score: LiveScore = {
      selectionRevision: room.selectionRevision,
      sequence: this.nextSequence(),
      score: gameState.score.score,
      combo: gameState.score.combo,
      maxCombo: gameState.score.maxCombo,
      perfectCount: gameState.score.perfectCount,
      greatCount: gameState.score.greatCount,
      goodCount: gameState.score.goodCount,
      missCount: gameState.score.missCount,
      gameTimeSeconds: gameState.gameTimeSeconds,
    };

    this.inFlight = true;
    try {
      await this.roomSession.reportScore(score);
      this.lastSignature = signature;
      this.lastSentAtMs = nowMs;
    } catch (error) {
      console.warn("Could not publish multiplayer score:", error);
    } finally {
      this.inFlight = false;
    }
  }

  private resetForInactiveRoom(): void {
    this.selectionRevision = null;
    this.sequence = 0;
    this.lastSignature = "";
    this.lastSentAtMs = 0;
  }
}
