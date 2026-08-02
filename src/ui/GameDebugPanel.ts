import type { GameState } from "../game/GameState";
import type { FootState } from "../types/FootState";
import type { RendererPerformanceStats } from "../rendering/CanvasRenderer";

const DEBUG_VISIBLE_STORAGE_KEY =
  "dance-vision.debug-visible";

const DEBUG_UPDATE_INTERVAL_MS = 125;

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);

  if (!element) {
    throw new Error(
      `Required debug element was not found: ${selector}`,
    );
  }

  return element;
}

function setTextIfChanged(
  element: Element,
  value: string,
): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function positionToLane(position: number): number {
  const lane = Math.floor(position * 4);

  return Math.min(
    Math.max(lane, 0),
    3,
  );
}

export class GameDebugPanel {
  private readonly panel: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly hideButton: HTMLButtonElement;
  private readonly leftX: HTMLElement;
  private readonly rightX: HTMLElement;
  private readonly leftLane: HTMLElement;
  private readonly rightLane: HTMLElement;
  private readonly gameTime: HTMLElement;
  private readonly gameStatus: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly renderAverage: HTMLElement;
  private readonly renderPercentile95: HTMLElement;
  private readonly renderMaximum: HTMLElement;
  private readonly renderOverBudget: HTMLElement;

  private visible = true;
  private lastUpdateTimeMs = -Infinity;

  private readonly handleToggleClick = (): void => {
    this.setVisible(!this.visible);
  };

  private readonly handleHideClick = (): void => {
    this.setVisible(false);
  };

  constructor(root: Document = document) {
    this.panel = requireElement<HTMLElement>(
      root,
      "#game-debug-panel",
    );

    this.toggleButton =
      requireElement<HTMLButtonElement>(
        root,
        "#debug-toggle-button",
      );

    this.hideButton =
      requireElement<HTMLButtonElement>(
        root,
        "#debug-hide-button",
      );

    this.leftX = requireElement<HTMLElement>(
      this.panel,
      "#debug-left-x",
    );

    this.rightX = requireElement<HTMLElement>(
      this.panel,
      "#debug-right-x",
    );

    this.leftLane = requireElement<HTMLElement>(
      this.panel,
      "#debug-left-lane",
    );

    this.rightLane = requireElement<HTMLElement>(
      this.panel,
      "#debug-right-lane",
    );

    this.gameTime = requireElement<HTMLElement>(
      this.panel,
      "#debug-game-time",
    );

    this.gameStatus = requireElement<HTMLElement>(
      this.panel,
      "#debug-game-status",
    );

    this.fps = requireElement<HTMLElement>(
      this.panel,
      "#debug-fps",
    );

    this.renderAverage = requireElement<HTMLElement>(
      this.panel,
      "#debug-render-average",
    );

    this.renderPercentile95 = requireElement<HTMLElement>(
      this.panel,
      "#debug-render-p95",
    );

    this.renderMaximum = requireElement<HTMLElement>(
      this.panel,
      "#debug-render-maximum",
    );

    this.renderOverBudget = requireElement<HTMLElement>(
      this.panel,
      "#debug-render-over-budget",
    );
  }

  public initialize(): void {
    this.toggleButton.addEventListener(
      "click",
      this.handleToggleClick,
    );

    this.hideButton.addEventListener(
      "click",
      this.handleHideClick,
    );

    this.setVisible(
      this.loadVisiblePreference(),
      false,
    );
  }

  public update(
    footState: Readonly<FootState>,
    gameState: Readonly<GameState>,
    framesPerSecond: number,
    rendererStats: Readonly<RendererPerformanceStats>,
    nowMs: number,
  ): void {
    if (!this.visible) {
      return;
    }

    if (
      nowMs - this.lastUpdateTimeMs <
      DEBUG_UPDATE_INTERVAL_MS
    ) {
      return;
    }

    this.lastUpdateTimeMs = nowMs;

    setTextIfChanged(
      this.leftX,
      footState.leftVisible
        ? footState.leftX.toFixed(3)
        : "hidden",
    );

    setTextIfChanged(
      this.rightX,
      footState.rightVisible
        ? footState.rightX.toFixed(3)
        : "hidden",
    );

    setTextIfChanged(
      this.leftLane,
      footState.leftVisible
        ? positionToLane(
            footState.leftX,
          ).toString()
        : "—",
    );

    setTextIfChanged(
      this.rightLane,
      footState.rightVisible
        ? positionToLane(
            footState.rightX,
          ).toString()
        : "—",
    );

    setTextIfChanged(
      this.gameTime,
      `${gameState.gameTimeSeconds.toFixed(3)} s`,
    );

    setTextIfChanged(
      this.gameStatus,
      gameState.status,
    );

    setTextIfChanged(
      this.fps,
      framesPerSecond.toFixed(1),
    );

    setTextIfChanged(
      this.renderAverage,
      `${rendererStats.averageMs.toFixed(2)} ms`,
    );

    setTextIfChanged(
      this.renderPercentile95,
      `${rendererStats.percentile95Ms.toFixed(2)} ms`,
    );

    setTextIfChanged(
      this.renderMaximum,
      `${rendererStats.maximumMs.toFixed(2)} ms`,
    );

    setTextIfChanged(
      this.renderOverBudget,
      `${rendererStats.framesOverBudget}/${rendererStats.sampleCount}`,
    );
  }

  public destroy(): void {
    this.toggleButton.removeEventListener(
      "click",
      this.handleToggleClick,
    );

    this.hideButton.removeEventListener(
      "click",
      this.handleHideClick,
    );
  }

  private setVisible(
    visible: boolean,
    persist = true,
  ): void {
    this.visible = visible;
    this.panel.hidden = !visible;

    setTextIfChanged(
      this.toggleButton,
      visible
        ? "Hide debug"
        : "Show debug",
    );

    this.toggleButton.setAttribute(
      "aria-pressed",
      visible
        ? "true"
        : "false",
    );

    if (persist) {
      localStorage.setItem(
        DEBUG_VISIBLE_STORAGE_KEY,
        visible
          ? "true"
          : "false",
      );
    }
  }

  private loadVisiblePreference(): boolean {
    return (
      localStorage.getItem(
        DEBUG_VISIBLE_STORAGE_KEY,
      ) !== "false"
    );
  }
}
