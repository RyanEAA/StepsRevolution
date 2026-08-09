import type { ViewManager } from "../app/ViewManager";
import type { AudioClock } from "../audio/AudioClock";
import type { Game } from "../game/Game";
import type { GameLoop } from "../loop/GameLoop";
import type { RuntimeChartBuilder } from "../stepmania/RuntimeChartBuilder";
import type { SessionManager } from "../session/SessionManager";
import type { StepManiaChart, StepManiaSimfile } from "../types/Chart";
import type { SongEntry } from "../types/Library";
import type { Lane } from "../types/Note";
import type { RoomSongPackage, RuntimeSongPackagePayload, SharedChartDescriptor } from "../../shared/relaySchemas";

export interface GameplayControllerCallbacks {
  closeSongDialog: () => void;
  hasLoadedLibrary: () => boolean;
  hasSelectedPack: () => boolean;
  reportOnlineFinished?: () => Promise<void>;
  handleOnlineReplay?: () => Promise<void>;
  handleOnlineChooseSong?: () => Promise<void>;
}

export interface GameplayControllerDependencies {
  game: Game;
  audioClock: AudioClock;
  gameLoop: GameLoop;
  viewManager: ViewManager;
  runtimeChartBuilder: RuntimeChartBuilder;
  sessionManager: SessionManager;
  callbacks: GameplayControllerCallbacks;
  navGameButton: HTMLButtonElement;
}

export class GameplayController {
  private readonly game: Game;
  private readonly audioClock: AudioClock;
  private readonly gameLoop: GameLoop;
  private readonly viewManager: ViewManager;
  private readonly runtimeChartBuilder: RuntimeChartBuilder;
  private readonly sessionManager: SessionManager;
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
  private readonly multiplayerResultsStatus: HTMLElement;
  private readonly audioFileStatus: HTMLElement;
  private readonly chartStatus: HTMLElement;
  private readonly libraryImportStatus: HTMLElement;
  private preparedOnlineRevision: number | null = null;
  private onlineStartTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineCountdownFrame: number | null = null;
  private readonly countdownOverlay = this.requireElement<HTMLElement>("#multiplayer-countdown-overlay");
  private readonly countdownValue = this.requireElement<HTMLElement>("#multiplayer-countdown-value");

  public constructor(dependencies: GameplayControllerDependencies) {
    this.game = dependencies.game;
    this.audioClock = dependencies.audioClock;
    this.gameLoop = dependencies.gameLoop;
    this.viewManager = dependencies.viewManager;
    this.runtimeChartBuilder = dependencies.runtimeChartBuilder;
    this.sessionManager = dependencies.sessionManager;
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
    this.multiplayerResultsStatus = this.requireElement<HTMLElement>("#multiplayer-results-status");
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
    this.cancelOnlineStart(false);
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
    const controls =
      this.sessionManager.getActiveSession().controlPolicy;

    this.startButton.disabled =
      !canPlay || !controls.immediateStart ||
      gameStatus === "playing" || gameStatus === "paused";

    this.pauseButton.disabled =
      !canPlay || !controls.localPause ||
      gameStatus === "idle" || gameStatus === "finished";

    this.restartButton.disabled = !canPlay || !controls.localRestart;
    this.resultsReplayButton.disabled = !controls.localReplay;
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
    this.audioClock.clear();
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
    if (!this.sessionManager.getActiveSession().controlPolicy.immediateStart) {
      throw new Error(
        "Online gameplay must be started by the room session.",
      );
    }

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

  public async prepareOnlineSong(
    songPackage: RoomSongPackage,
    chart: SharedChartDescriptor,
    runtime: RuntimeSongPackagePayload,
    audio: Blob,
  ): Promise<void> {
    if (this.sessionManager.getActiveSession().kind !== "online") {
      throw new Error("Online song preparation requires an active room session.");
    }
    const runtimeChart = runtime.charts.find((candidate) =>
      candidate.chartId === chart.chartId && candidate.chartHash === chart.chartHash);
    if (!runtimeChart || runtimeChart.notes.length === 0) {
      throw new Error("The selected shared difficulty has no playable notes.");
    }
    if (this.preparedOnlineRevision !== songPackage.selectionRevision) {
      this.audioClock.stop();
      const audioFile = new File([audio], `${songPackage.songId}.audio`, {
        type: songPackage.audio.mimeType,
      });
      await this.audioClock.loadFile(audioFile);
      this.preparedOnlineRevision = songPackage.selectionRevision;
    }
    this.game.loadChart(runtimeChart.notes.map((note) => ({
      lane: note.lane as Lane,
      hitTimeSeconds: note.hitTimeSeconds,
    })));
    this.gameplayTitle.textContent = songPackage.title;
    this.gameplaySongArtist.textContent =
      `${songPackage.artist || "Unknown artist"} · ${chart.difficulty} · Meter ${chart.meter}`;
    this.audioFileStatus.textContent =
      `Shared audio ready — ${this.formatTime(this.audioClock.getDurationSeconds())}`;
    this.chartStatus.textContent =
      `${chart.difficulty} · Meter ${chart.meter} · ${chart.tapCount} taps`;
    this.gameLoop.syncGameStatus();
    this.updateButtonState();
  }

  public clearOnlinePreparation(): void {
    this.cancelOnlineStart(false);
    if (this.preparedOnlineRevision === null) return;
    this.preparedOnlineRevision = null;
    this.audioClock.clear();
    this.game.reset();
    this.gameLoop.syncGameStatus();
    this.updateButtonState();
  }

  public async unlockOnlineAudio(): Promise<void> {
    await this.audioClock.unlock();
  }

  public async scheduleOnlineStart(localPerformanceTimeMs: number): Promise<void> {
    if (this.preparedOnlineRevision === null || !this.game.hasChart() || !this.audioClock.hasAudio()) {
      throw new Error("The shared song and selected difficulty are not prepared.");
    }
    this.cancelOnlineStart(false);
    await this.audioClock.scheduleFromStart(localPerformanceTimeMs);
    this.viewManager.show("gameplay");
    this.countdownOverlay.hidden = false;
    const renderCountdown = (): void => {
      const remainingMs = localPerformanceTimeMs - performance.now();
      this.countdownValue.textContent = remainingMs > 0 ? String(Math.max(1, Math.ceil(remainingMs / 1000))) : "GO";
      if (remainingMs > -500) this.onlineCountdownFrame = requestAnimationFrame(renderCountdown);
      else { this.countdownOverlay.hidden = true; this.onlineCountdownFrame = null; }
    };
    renderCountdown();
    this.onlineStartTimer = setTimeout(() => {
      this.onlineStartTimer = null;
      this.game.start();
      this.gameLoop.syncGameStatus();
      this.updateButtonState();
    }, Math.max(0, localPerformanceTimeMs - performance.now()));
  }

  public cancelOnlineStart(returnToLobby = true): void {
    if (this.onlineStartTimer) clearTimeout(this.onlineStartTimer);
    if (this.onlineCountdownFrame !== null) cancelAnimationFrame(this.onlineCountdownFrame);
    this.onlineStartTimer = null;
    this.onlineCountdownFrame = null;
    this.countdownOverlay.hidden = true;
    if (this.game.getState().status !== "playing") {
      this.audioClock.stop();
      this.game.reset();
      this.gameLoop.syncGameStatus();
      if (returnToLobby) this.viewManager.show("multiplayer-lobby");
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
    if (this.sessionManager.getActiveSession().kind === "online") {
      this.resultsReplayButton.disabled = true;
      this.resultsSongSelectButton.disabled = true;
      this.multiplayerResultsStatus.textContent = "Waiting for every player to finish…";
      void this.callbacks.reportOnlineFinished?.().catch((error) => {
        this.multiplayerResultsStatus.textContent = error instanceof Error ? error.message : "Could not report the final result.";
      });
    }
  }

  public renderOnlineResults(options: {
    roomInResults: boolean;
    isHost: boolean;
    localReplayRequested: boolean;
    everyoneRequestedReplay: boolean;
  }): void {
    if (!options.roomInResults) return;
    this.resultsReplayButton.disabled = false;
    this.resultsReplayButton.textContent = options.isHost && options.everyoneRequestedReplay
      ? "Confirm play again"
      : options.localReplayRequested ? "Play again requested" : "Play again";
    this.resultsSongSelectButton.hidden = !options.isHost;
    this.resultsSongSelectButton.disabled = !options.isHost;
    this.multiplayerResultsStatus.textContent = options.everyoneRequestedReplay
      ? options.isHost ? "Everyone wants to replay. Confirm when ready." : "Waiting for the host to confirm replay."
      : "Each player can request another round.";
  }

  public reportAudioError(error: unknown): void {
    console.error(error);

    this.audioFileStatus.textContent =
      error instanceof Error ? error.message : "An audio error occurred.";
  }

  private async start(): Promise<void> {
    if (!this.sessionManager.getActiveSession().controlPolicy.immediateStart) {
      return;
    }

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
    if (!this.sessionManager.getActiveSession().controlPolicy.localPause) {
      return;
    }

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
    if (!this.sessionManager.getActiveSession().controlPolicy.localRestart) {
      return;
    }

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
    if (this.sessionManager.getActiveSession().kind === "online") {
      void this.callbacks.handleOnlineReplay?.().catch((error) => {
        this.multiplayerResultsStatus.textContent = error instanceof Error ? error.message : "Replay request failed.";
      });
      return;
    }
    if (!this.sessionManager.getActiveSession().controlPolicy.localReplay) {
      return;
    }

    this.viewManager.show("gameplay");
    void this.restart();
  };

  private readonly handleResultsSongSelectClick = (): void => {
    if (this.sessionManager.getActiveSession().kind === "online") {
      void this.callbacks.handleOnlineChooseSong?.().catch((error) => {
        this.multiplayerResultsStatus.textContent = error instanceof Error ? error.message : "Could not return to song selection.";
      });
      return;
    }
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
