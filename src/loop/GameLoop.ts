import type { AudioClock } from "../audio/AudioClock";
import type { CameraFootInput } from "../camera/CameraFootInput";
import type { Game } from "../game/Game";
import type { GameStatus } from "../game/GameState";
import type { InputManager } from "../input/InputManager";
import type { CanvasRenderer } from "../rendering/CanvasRenderer";
import type { CameraTrackingDebugPanel } from "../ui/CameraTrackingDebugPanel";
import type { GameDebugPanel } from "../ui/GameDebugPanel";
import type { ViewManager } from "../app/ViewManager";

export interface GameLoopDependencies {
  input: InputManager;
  cameraInput: CameraFootInput;
  game: Game;
  audioClock: AudioClock;
  renderer: CanvasRenderer;
  viewManager: ViewManager;
  gameDebugPanel: GameDebugPanel;
  cameraTrackingDebugPanel: CameraTrackingDebugPanel;
  onGameFinished: () => void;
  onFrameCompleted: () => void;
}

export class GameLoop {
  private readonly input: InputManager;
  private readonly cameraInput: CameraFootInput;
  private readonly game: Game;
  private readonly audioClock: AudioClock;
  private readonly renderer: CanvasRenderer;
  private readonly viewManager: ViewManager;
  private readonly gameDebugPanel: GameDebugPanel;
  private readonly cameraTrackingDebugPanel: CameraTrackingDebugPanel;
  private readonly onGameFinished: () => void;
  private readonly onFrameCompleted: () => void;

  private animationFrameId: number | null = null;
  private previousFrameTimeMs = 0;
  private smoothedFramesPerSecond = 60;
  private previousGameStatus: GameStatus;

  constructor(dependencies: GameLoopDependencies) {
    this.input = dependencies.input;
    this.cameraInput = dependencies.cameraInput;
    this.game = dependencies.game;
    this.audioClock = dependencies.audioClock;
    this.renderer = dependencies.renderer;
    this.viewManager = dependencies.viewManager;
    this.gameDebugPanel = dependencies.gameDebugPanel;
    this.cameraTrackingDebugPanel =
      dependencies.cameraTrackingDebugPanel;
    this.onGameFinished = dependencies.onGameFinished;
    this.onFrameCompleted = dependencies.onFrameCompleted;

    this.previousGameStatus = this.game.getState().status;
  }

  public start(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    this.previousFrameTimeMs = performance.now();
    this.previousGameStatus = this.game.getState().status;
    this.animationFrameId = requestAnimationFrame(this.handleFrame);
  }

  public stop(): void {
    if (this.animationFrameId === null) {
      return;
    }

    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  public syncGameStatus(): void {
    this.previousGameStatus = this.game.getState().status;
  }

  private readonly handleFrame = (
    currentFrameTimeMs: number,
  ): void => {
    const rawDeltaSeconds =
      (currentFrameTimeMs - this.previousFrameTimeMs) / 1000;

    const deltaSeconds = Math.min(
      rawDeltaSeconds,
      0.1,
    );

    this.previousFrameTimeMs = currentFrameTimeMs;

    this.input.update(deltaSeconds);

    const footState = this.input.getFootState();

    this.cameraTrackingDebugPanel.update(
      this.cameraInput.getDebugState(),
      currentFrameTimeMs,
    );

    const statusBeforeUpdate = this.game.getState().status;

    if (statusBeforeUpdate === "playing") {
      this.game.update(
        this.audioClock.getCurrentTimeSeconds(),
        footState,
      );
    }

    if (
      this.audioClock.getStatus() === "finished" &&
      this.game.getState().status === "playing"
    ) {
      this.game.pause();
    }

    const currentFramesPerSecond =
      deltaSeconds > 0
        ? 1 / deltaSeconds
        : this.smoothedFramesPerSecond;

    this.smoothedFramesPerSecond =
      this.smoothedFramesPerSecond * 0.9 +
      currentFramesPerSecond * 0.1;

    const gameState = this.game.getState();

    this.gameDebugPanel.update(
      footState,
      gameState,
      this.smoothedFramesPerSecond,
      currentFrameTimeMs,
    );

    if (this.viewManager.isShowing("gameplay")) {
      this.renderer.render(
        footState,
        this.game.getVisibleNotes(),
        gameState,
      );
    }

    if (
      this.previousGameStatus !== "finished" &&
      gameState.status === "finished"
    ) {
      this.onGameFinished();
    }

    this.previousGameStatus = gameState.status;

    this.onFrameCompleted();

    this.animationFrameId = requestAnimationFrame(this.handleFrame);
  };
}
