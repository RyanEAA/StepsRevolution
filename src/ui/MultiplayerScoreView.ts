import type { RoomPlayer, RoomState } from "../../shared/schemas";

export class MultiplayerScoreView {
  private readonly sidebar = this.requireElement<HTMLElement>("#multiplayer-score-sidebar");
  private readonly scoreList = this.requireElement<HTMLOListElement>("#multiplayer-score-list");
  private readonly standings = this.requireElement<HTMLElement>("#multiplayer-standings");
  private readonly standingsList = this.requireElement<HTMLOListElement>("#multiplayer-standings-list");

  public render(room: RoomState | null, localPlayerId: string | null): void {
    const showLive = room?.phase === "countdown" || room?.phase === "playing";
    this.sidebar.hidden = !showLive;
    if (showLive && room) {
      this.renderPlayers(this.scoreList, room.players, localPlayerId, false);
    } else {
      this.scoreList.replaceChildren();
    }

    const showStandings = room?.phase === "results";
    this.standings.hidden = !showStandings;
    if (showStandings && room) {
      this.renderPlayers(this.standingsList, room.players, localPlayerId, true);
    } else {
      this.standingsList.replaceChildren();
    }
  }

  private renderPlayers(
    list: HTMLOListElement,
    players: readonly RoomPlayer[],
    localPlayerId: string | null,
    final: boolean,
  ): void {
    const sorted = [...players].sort((left, right) => {
      const leftScore = final ? left.finalResult?.score ?? -1 : left.liveScore?.score ?? 0;
      const rightScore = final ? right.finalResult?.score ?? -1 : right.liveScore?.score ?? 0;
      return rightScore - leftScore || left.joinedAtServerMs - right.joinedAtServerMs;
    });
    list.replaceChildren(...sorted.map((player) => this.playerItem(player, localPlayerId, final)));
  }

  private playerItem(player: RoomPlayer, localPlayerId: string | null, final: boolean): HTMLLIElement {
    const result = final ? player.finalResult : player.liveScore;
    const item = document.createElement("li");
    item.className = "multiplayer-score-item";
    if (player.playerId === localPlayerId) item.classList.add("multiplayer-score-item--local");

    const identity = document.createElement("span");
    identity.className = "multiplayer-score-item__identity";
    const name = document.createElement("strong");
    const wins = player.winCount === 0
      ? ""
      : player.winCount === 1 ? " ⭐" : ` ${player.winCount} × ⭐`;
    name.textContent = `${player.playerId === localPlayerId ? `${player.displayLabel} (you)` : player.displayLabel}${wins}`;
    const status = document.createElement("small");
    status.textContent = player.connectionStatus === "disconnected"
      ? "Disconnected"
      : player.finalResult ? "Finished" : final ? "No result" : `Combo ${result?.combo ?? 0}`;
    identity.append(name, status);

    const score = document.createElement("strong");
    score.className = "multiplayer-score-item__score";
    score.textContent = result ? result.score.toLocaleString() : "—";
    item.append(identity, score);
    return item;
  }

  private requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Required multiplayer score element was not found: ${selector}`);
    return element;
  }
}
