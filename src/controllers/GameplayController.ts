import type { ViewManager } from "../app/ViewManager";
import type { AudioClock } from "../audio/AudioClock";
import type { Game } from "../game/Game";
import type { GameLoop } from "../loop/GameLoop";
import type { RuntimeChartBuilder } from "../stepmania/RuntimeChartBuilder";
import type { StepManiaChart, StepManiaSimfile } from "../types/Chart";
import type { SongEntry } from "../types/Library";

export interface GameplayControllerCallbacks {
  closeSongDialog: () => void;
  hasLoadedLibrary: () => boolean;
  hasSelectedPack: () => boolean;
}

export interface GameplayControllerDependencies {
  game: Game;
  audioClock: AudioClock;
  gameLoop: GameLoop;
  viewManager: ViewManager;
  runtimeChartBuilder: RuntimeChartBuilder;
  callbacks: GameplayControllerCallbacks;
  navGameButton: HTMLButtonElement;
}

export class GameplayController {
  private readonly game: Game;
  private readonly audioClock: AudioClock;
  private readonly gameLoop: GameLoop;
  private readonly viewManager: ViewManager;
  private readonly runtimeChartBuilder: RuntimeChartBuilder;
  private readonly callbacks: GameplayControllerCallbacks;
  private readonly navGameButton: HTMLButtonElement;

  private readonly gameplayTitle: HTMLElement;
  private readonly gameplaySongArtist: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly restartButton: HTMLButtonElement;
  private readonly exitGameButton: HTMLButtonElement;
  private readonly resultsScoreValue: HTMLElement;
  private readonly resultsPerfectCount: HTMLElement;
  private readonly resultsGreatCount: HTMLElement;
  private readonly resultsGoodCount: HTMLElement;
  private readonly resultsMissCount: HTMLElement;
  private readonly resultsMaxCombo: HTMLElement;
  private readonly resultsReplayButton: HTMLButtonElement;
  private readonly resultsSongSelectButton: HTMLButtonElement;
  private readonly audioFileStatus: HTMLElement;
  private readonly chartStatus: HTMLElement;
  private readonly libraryImportStatus: HTMLElement;

  public constructor(dependencies: GameplayControllerDependencies) {
    this.game = dependencies.game;
    this.audioClock = dependencies.audioClock;
    this.gameLoop = dependencies.gameLoop;
    this.viewManager = dependencies.viewManager;
    this.runtimeChartBuilder = dependencies.runtimeChartBuilder;
    this.callbacks = dependencies.callbacks;
    this.navGameButton = dependencies.navGameButton;

    this.gameplayTitle = this.requireElement<HTMLElement>("#gameplay-title");
    this.gameplaySongArtist = this.requireElement<HTMLElement>("#gameplay-song-artist");
    this.startButton = this.requireElement<HTMLButtonElement>("#start-button");
    this.pauseButton = this.requireElement<HTMLButtonElement>("#pause-button");
    this.restartButton = this.requireElement<HTMLButtonElement>("#restart-button");
    this.exitGameButton = this.requireElement<HTMLButtonElement>("#exit-game-button");
    this.resultsScoreValue = this.requireElement<HTMLElement>("#results-score-value");
    this.resultsPerfectCount = this.requireElement<HTMLElement>("#results-perfect-count");
    this.resultsGreatCount = this.requireElement<HTMLElement>("#results-great-count");
    this.resultsGoodCount = this.requireElement<HTMLElement>("#results-good-count");
    this.resultsMissCount = this.requireElement<HTMLElement>("#results-miss-count");
    this.resultsMaxCombo = this.requireElement<HTMLElement>("#results-max-combo");
    this.resultsReplayButton = this.requireElement<HTMLButtonElement>("#results-replay-button");
    this.resultsSongSelectButton = this.requireElement<HTMLButtonElement>("#results-song-select-button");
    this.audioFileStatus = this.requireElement<HTMLElement>("#audio-file-status");
    this.chartStatus = this.requireElement<HTMLElement>("#chart-status");
    this.libraryImportStatus = this.requireElement<HTMLElement>("#library-import-status");
  }

  public initialize(): void {
    this.startButton.addEventListener("click", this.handleStartClick);
    this.pauseButton.addEventListener("click", this.handlePauseClick);
    this.restartButton.addEventListener("click", this.handleRestartClick);
    this.exitGameButton.addEventListener("click", this.handleExitGameClick);
    this.resultsReplayButton.addEventListener("click", this.handleReplayClick);
    this.resultsSongSelectButton.addEventListener("click", this.handleResultsSongSelectClick);
    this.navGameButton.addEventListener("click", this.handleNavGameClick);

    this.updateButtonState();
  }

  public destroy(): void {
    this.startButton.removeEventListener("click", this.handleStartClick);
    this.pauseButton.removeEventListener("click", this.handlePauseClick);
    this.restartButton.removeEventListener("click", this.handleRestartClick);
    this.exitGameButton.removeEventListener("click", this.handleExitGameClick);
    this.resultsReplayButton.removeEventListener("click", this.handleReplayClick);
    this.resultsSongSelectButton.removeEventListener("click", this.handleResultsSongSelectClick);
    this.navGameButton.removeEventListener("click", this.handleNavGameClick);
  }

  public updateButtonState(): void {
    const gameStatus = this.game.getState().status;
    const canPlay = this.audioClock.hasAudio() && this.game.hasChart();

    this.startButton.disabled =
      !canPlay || gameStatus === "playing" || gameStatus === "paused";

    this.pauseButton.disabled =
      !canPlay || gameStatus === "idle" || gameStatus === "finished";

    this.restartButton.disabled = !canPlay;
    this.pauseButton.textContent = gameStatus === "paused" ? "Resume" : "Pause";
    this.navGameButton.disabled = !canPlay;

    this.gameLoop.requestRender();
  }

  public async loadDeveloperAudio(file: File): Promise<void> {
    await this.audioClock.loadFile(file);

    this.audioFileStatus.textContent =
      `${file.name} — ${this.formatTime(this.audioClock.getDurationSeconds())}`;

    this.game.reset();
    this.gameLoop.syncGameStatus();
    this.updateButtonState();
  }

  public stopForSimfileChange(): void {
    this.game.reset();
    this.audioClock.stop();
    this.gameLoop.syncGameStatus();
    this.updateButtonState();
  }

  public resetGame(): void {
    this.game.reset();
    this.gameLoop.syncGameStatus();
    this.updateButtonState();
  }

  public loadChart(simfile: StepManiaSimfile, chart: StepManiaChart): void {
    const runtimeNotes = this.runtimeChartBuilder.build(simfile, chart);

    if (runtimeNotes.length === 0) {
      throw new Error("The selected chart has no supported tap notes.");
    }

    this.game.loadChart(
      runtimeNotes.map((note) => ({
        lane: note.lane,
        hitTimeSeconds: note.hitTimeSeconds,
      })),
    );

    this.gameLoop.syncGameStatus();
    this.updateButtonState();

    console.log("Loaded runtime chart:", runtimeNotes);
  }

  public async launchLibrarySong(song: SongEntry, chart: StepManiaChart): Promise<void> {
    if (!song.audioFile) {
      this.libraryImportStatus.textContent =
        `${song.title} is missing its audio file.`;
      return;
    }

    try {
      this.audioClock.stop();
      await this.audioClock.loadFile(song.audioFile);
      this.loadChart(song.simfile, chart);

      this.gameplayTitle.textContent = song.title;
      this.gameplaySongArtist.textContent =
        `${song.artist} · ${chart.difficulty} · Meter ${chart.meter}`;

      this.audioFileStatus.textContent =
        `${song.audioFile.name} — ${this.formatTime(this.audioClock.getDurationSeconds())}`;

      this.viewManager.show("gameplay");

      this.game.start();
      this.gameLoop.syncGameStatus();
      await this.audioClock.playFromStart();
      this.updateButtonState();
    } catch (error) {
      this.game.reset();
      this.gameLoop.syncGameStatus();
      this.reportAudioError(error);
      this.viewManager.show("song-selection");
    }
  }

  public showResults(): void {
    const score = this.game.getState().score;

    this.resultsScoreValue.textContent = score.score.toLocaleString();
    this.resultsPerfectCount.textContent = score.perfectCount.toString();
    this.resultsGreatCount.textContent = score.greatCount.toString();
    this.resultsGoodCount.textContent = score.goodCount.toString();
    this.resultsMissCount.textContent = score.missCount.toString();
    this.resultsMaxCombo.textContent = score.maxCombo.toString();

    this.audioClock.stop();
    this.viewManager.show("results");
  }

  public reportAudioError(error: unknown): void {
    console.error(error);

    this.audioFileStatus.textContent =
      error instanceof Error ? error.message : "An audio error occurred.";
  }

  private async start(): Promise<void> {
    if (!this.game.hasChart()) {
      this.chartStatus.textContent = "Select a chart before starting.";
      return;
    }

    if (!this.audioClock.hasAudio()) {
      this.audioFileStatus.textContent = "Load the song audio before starting.";
      return;
    }

    try {
      this.game.start();
      this.gameLoop.syncGameStatus();
      await this.audioClock.playFromStart();
    } catch (error) {
      this.game.pause();
      this.gameLoop.syncGameStatus();
      this.reportAudioError(error);
    }
  }

  private async togglePause(): Promise<void> {
    try {
      const status = this.game.getState().status;

      if (status === "playing") {
        await this.audioClock.pause();
        this.game.pause();
        this.gameLoop.syncGameStatus();
        return;
      }

      if (status === "paused") {
        await this.audioClock.resume();
        this.game.resume();
        this.gameLoop.syncGameStatus();
      }
    } catch (error) {
      this.reportAudioError(error);
    }
  }

  private async restart(): Promise<void> {
    try {
      this.game.restart();
      this.gameLoop.syncGameStatus();
      await this.audioClock.restart();
    } catch (error) {
      this.game.pause();
      this.gameLoop.syncGameStatus();
      this.reportAudioError(error);
    }
  }

  private returnToSongSelection(): void {
    this.audioClock.stop();
    this.game.reset();
    this.gameLoop.syncGameStatus();
    this.callbacks.closeSongDialog();

    if (this.callbacks.hasSelectedPack()) {
      this.viewManager.show("song-selection");
      return;
    }

    if (this.callbacks.hasLoadedLibrary()) {
      this.viewManager.show("pack-selection");
      return;
    }

    this.viewManager.show("library-import");
  }

  private readonly handleStartClick = (): void => {
    void this.start();
  };

  private readonly handlePauseClick = (): void => {
    void this.togglePause();
  };

  private readonly handleRestartClick = (): void => {
    void this.restart();
  };

  private readonly handleExitGameClick = (): void => {
    this.returnToSongSelection();
  };

  private readonly handleReplayClick = (): void => {
    this.viewManager.show("gameplay");
    void this.restart();
  };

  private readonly handleResultsSongSelectClick = (): void => {
    this.game.reset();
    this.audioClock.stop();
    this.gameLoop.syncGameStatus();
    this.viewManager.show("song-selection");
  };

  private readonly handleNavGameClick = (): void => {
    if (this.game.hasChart() && this.audioClock.hasAudio()) {
      this.viewManager.show("gameplay");
    }
  };

  private formatTime(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);

    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  private requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);

    if (!element) {
      throw new Error(`Required element was not found: ${selector}`);
    }

    return element;
  }
}
