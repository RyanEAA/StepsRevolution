import "./style.css";

import { ViewManager } from "./app/ViewManager";
import { AudioClock } from "./audio/AudioClock";
import { Game } from "./game/Game";
import { FolderImporter } from "./library/FolderImporter";
import { LibraryBuilder } from "./library/LibraryBuilder";
import { KeyboardInput } from "./input/KeyboardInput";
import { CanvasRenderer } from "./rendering/CanvasRenderer";
import { RuntimeChartBuilder } from "./stepmania/RuntimeChartBuilder";
import { SimfileParser } from "./stepmania/SimfileParser";
import type {
  StepManiaChart,
  StepManiaSimfile,
} from "./types/Chart";
import type {
  SongEntry,
  SongLibrary,
  SongPack,
} from "./types/Library";
import { LibraryView } from "./ui/LibraryView";

/* =========================================================
   DOM HELPERS
   ========================================================= */

function requireElement<T extends Element>(
  selector: string,
): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(
      `Required element was not found: ${selector}`,
    );
  }

  return element;
}

/* =========================================================
   MAIN VIEWS
   ========================================================= */

const libraryImportView =
  requireElement<HTMLElement>("#library-import-view");

const packSelectionView =
  requireElement<HTMLElement>(
    "#pack-selection-section",
  );

const songSelectionView =
  requireElement<HTMLElement>(
    "#song-selection-section",
  );

const gameplayView =
  requireElement<HTMLElement>("#gameplay-view");

const resultsView =
  requireElement<HTMLElement>("#results-view");

/* =========================================================
   GLOBAL NAVIGATION
   ========================================================= */

const navLibraryButton =
  requireElement<HTMLButtonElement>(
    "#nav-library-button",
  );

const navGameButton =
  requireElement<HTMLButtonElement>(
    "#nav-game-button",
  );

const importAnotherLibraryButton =
  requireElement<HTMLButtonElement>(
    "#import-another-library-button",
  );

const backToPacksButton =
  requireElement<HTMLButtonElement>(
    "#back-to-packs-button",
  );

const exitGameButton =
  requireElement<HTMLButtonElement>(
    "#exit-game-button",
  );

/* =========================================================
   LIBRARY IMPORT
   ========================================================= */

const libraryFolderInput =
  requireElement<HTMLInputElement>(
    "#library-folder-input",
  );

const libraryImportStatus =
  requireElement<HTMLElement>(
    "#library-import-status",
  );

const packCardContainer =
  requireElement<HTMLElement>(
    "#pack-card-container",
  );

const songCardContainer =
  requireElement<HTMLElement>(
    "#song-card-container",
  );

const songSectionTitle =
  requireElement<HTMLElement>(
    "#song-section-title",
  );

/* =========================================================
   SELECTED SONG PANEL
   ========================================================= */

const selectedSongPanel =
  requireElement<HTMLElement>(
    "#selected-song-panel",
  );

const selectedSongImage =
  requireElement<HTMLImageElement>(
    "#selected-song-image",
  );

const selectedSongTitle =
  requireElement<HTMLElement>(
    "#selected-song-title",
  );

const selectedSongArtist =
  requireElement<HTMLElement>(
    "#selected-song-artist",
  );

const selectedSongBpm =
  requireElement<HTMLElement>(
    "#selected-song-bpm",
  );

const selectedSongPack =
  requireElement<HTMLElement>(
    "#selected-song-pack",
  );

const libraryChartSelect =
  requireElement<HTMLSelectElement>(
    "#library-chart-select",
  );

const playSelectedSongButton =
  requireElement<HTMLButtonElement>(
    "#play-selected-song-button",
  );

/* =========================================================
   GAMEPLAY
   ========================================================= */

const canvas =
  requireElement<HTMLCanvasElement>(
    "#game-canvas",
  );

const gameplayTitle =
  requireElement<HTMLElement>(
    "#gameplay-title",
  );

const gameplaySongArtist =
  requireElement<HTMLElement>(
    "#gameplay-song-artist",
  );

const startButton =
  requireElement<HTMLButtonElement>(
    "#start-button",
  );

const pauseButton =
  requireElement<HTMLButtonElement>(
    "#pause-button",
  );

const restartButton =
  requireElement<HTMLButtonElement>(
    "#restart-button",
  );

/* =========================================================
   RESULTS
   ========================================================= */

const resultsScoreValue =
  requireElement<HTMLElement>(
    "#results-score-value",
  );

const resultsPerfectCount =
  requireElement<HTMLElement>(
    "#results-perfect-count",
  );

const resultsGreatCount =
  requireElement<HTMLElement>(
    "#results-great-count",
  );

const resultsGoodCount =
  requireElement<HTMLElement>(
    "#results-good-count",
  );

const resultsMissCount =
  requireElement<HTMLElement>(
    "#results-miss-count",
  );

const resultsMaxCombo =
  requireElement<HTMLElement>(
    "#results-max-combo",
  );

const resultsReplayButton =
  requireElement<HTMLButtonElement>(
    "#results-replay-button",
  );

const resultsSongSelectButton =
  requireElement<HTMLButtonElement>(
    "#results-song-select-button",
  );

/* =========================================================
   DEVELOPER FILE CONTROLS
   ========================================================= */

const simfileInput =
  requireElement<HTMLInputElement>(
    "#simfile-input",
  );

const simfileStatus =
  requireElement<HTMLElement>(
    "#simfile-status",
  );

const chartSelect =
  requireElement<HTMLSelectElement>(
    "#chart-select",
  );

const chartStatus =
  requireElement<HTMLElement>(
    "#chart-status",
  );

const audioFileInput =
  requireElement<HTMLInputElement>(
    "#audio-file-input",
  );

const audioFileStatus =
  requireElement<HTMLElement>(
    "#audio-file-status",
  );

/* =========================================================
   CORE OBJECTS
   ========================================================= */

const viewManager = new ViewManager({
  "library-import": libraryImportView,
  "pack-selection": packSelectionView,
  "song-selection": songSelectionView,
  gameplay: gameplayView,
  results: resultsView,
});

const input = new KeyboardInput();
const renderer = new CanvasRenderer(canvas);
const game = new Game();
const audioClock = new AudioClock();

const simfileParser = new SimfileParser();
const runtimeChartBuilder = new RuntimeChartBuilder();

const folderImporter = new FolderImporter();
const libraryBuilder = new LibraryBuilder();

/* =========================================================
   APPLICATION STATE
   ========================================================= */

let loadedSimfile: StepManiaSimfile | null = null;
let selectedChart: StepManiaChart | null = null;

let loadedLibrary: SongLibrary | null = null;
let selectedLibrarySong: SongEntry | null = null;
let selectedLibraryChart: StepManiaChart | null = null;

let previousFrameTimeMs = performance.now();
let animationFrameId = 0;
let smoothedFramesPerSecond = 60;

let previousGameStatus =
  game.getState().status;

/* =========================================================
   LIBRARY VIEW
   ========================================================= */

const libraryView = new LibraryView(
  packCardContainer,
  songCardContainer,
  songSectionTitle,
  {
    onPackSelected(pack: SongPack): void {
      selectedLibrarySong = null;
      selectedLibraryChart = null;

      resetSelectedSongPanel();

      console.log(
        "Selected pack:",
        pack,
      );

      viewManager.show(
        "song-selection",
      );
    },

    onSongSelected(song: SongEntry): void {
      handleLibrarySongSelection(song);
    },
  },
);

/* =========================================================
   ANIMATION LOOP
   ========================================================= */

function gameLoop(
  currentFrameTimeMs: number,
): void {
  const rawDeltaSeconds =
    (currentFrameTimeMs -
      previousFrameTimeMs) /
    1000;

  const deltaSeconds = Math.min(
    rawDeltaSeconds,
    0.1,
  );

  previousFrameTimeMs =
    currentFrameTimeMs;

  input.update(deltaSeconds);

  const footState =
    input.getFootState();

  const statusBeforeUpdate =
    game.getState().status;

  if (statusBeforeUpdate === "playing") {
    game.update(
      audioClock.getCurrentTimeSeconds(),
      footState,
    );
  }

  if (
    audioClock.getStatus() === "finished" &&
    game.getState().status === "playing"
  ) {
    game.pause();
  }

  const currentFramesPerSecond =
    deltaSeconds > 0
      ? 1 / deltaSeconds
      : smoothedFramesPerSecond;

  smoothedFramesPerSecond =
    smoothedFramesPerSecond * 0.9 +
    currentFramesPerSecond * 0.1;

  const gameState = game.getState();

  /*
   * Canvas rendering is only useful while the gameplay view is open.
   * Avoiding unnecessary drawing also makes the menu views lighter.
   */
  if (viewManager.isShowing("gameplay")) {
    renderer.render(
      footState,
      game.getVisibleNotes(),
      gameState,
      smoothedFramesPerSecond,
    );
  }

  if (
    previousGameStatus !== "finished" &&
    gameState.status === "finished"
  ) {
    showResults();
  }

  previousGameStatus =
    gameState.status;

  updateButtonState();

  animationFrameId =
    requestAnimationFrame(gameLoop);
}

/* =========================================================
   GAME BUTTON STATE
   ========================================================= */

function updateButtonState(): void {
  const gameStatus =
    game.getState().status;

  const canPlay =
    audioClock.hasAudio() &&
    game.hasChart();

  startButton.disabled =
    !canPlay ||
    gameStatus === "playing" ||
    gameStatus === "paused";

  pauseButton.disabled =
    !canPlay ||
    gameStatus === "idle" ||
    gameStatus === "finished";

  restartButton.disabled = !canPlay;

  pauseButton.textContent =
    gameStatus === "paused"
      ? "Resume"
      : "Pause";

  navGameButton.disabled = !canPlay;
}

/* =========================================================
   DEVELOPER AUDIO LOADING
   ========================================================= */

async function handleAudioSelection(): Promise<void> {
  const file =
    audioFileInput.files?.[0];

  if (!file) {
    audioFileStatus.textContent =
      "No audio loaded";

    return;
  }

  audioFileInput.disabled = true;

  audioFileStatus.textContent =
    `Loading ${file.name}...`;

  try {
    await audioClock.loadFile(file);

    audioFileStatus.textContent =
      `${file.name} — ` +
      formatTime(
        audioClock.getDurationSeconds(),
      );

    game.reset();
  } catch (error) {
    reportAudioError(error);
  } finally {
    audioFileInput.disabled = false;
    updateButtonState();
  }
}

/* =========================================================
   DEVELOPER SIMFILE LOADING
   ========================================================= */

async function handleSimfileSelection(): Promise<void> {
  const file =
    simfileInput.files?.[0];

  if (!file) {
    clearLoadedSimfile();
    return;
  }

  simfileInput.disabled = true;

  simfileStatus.textContent =
    `Loading ${file.name}...`;

  try {
    const contents =
      await file.text();

    const simfile =
      simfileParser.parse(contents);

    if (simfile.charts.length === 0) {
      throw new Error(
        "No supported dance-single charts were found.",
      );
    }

    loadedSimfile = simfile;
    selectedChart = null;

    populateDeveloperChartSelect(
      simfile,
    );

    simfileStatus.textContent =
      `${simfile.title} — ` +
      `${simfile.artist}`;

    chartStatus.textContent =
      `${simfile.charts.length} ` +
      "difficulties available";

    game.reset();
    audioClock.stop();
  } catch (error) {
    console.error(error);

    clearLoadedSimfile();

    simfileStatus.textContent =
      error instanceof Error
        ? error.message
        : "Could not parse the .sm file.";
  } finally {
    simfileInput.disabled = false;
    updateButtonState();
  }
}

function populateDeveloperChartSelect(
  simfile: StepManiaSimfile,
): void {
  chartSelect.replaceChildren();

  const placeholder =
    document.createElement("option");

  placeholder.value = "";
  placeholder.textContent =
    "Select a difficulty";

  chartSelect.append(placeholder);

  simfile.charts.forEach(
    (chart, index) => {
      const option =
        document.createElement("option");

      option.value =
        index.toString();

      option.textContent =
        `${chart.difficulty} ` +
        `(Meter ${chart.meter}) — ` +
        `${chart.notes.length} taps`;

      chartSelect.append(option);
    },
  );

  chartSelect.disabled = false;
  chartSelect.value = "";
}

function clearLoadedSimfile(): void {
  loadedSimfile = null;
  selectedChart = null;

  chartSelect.replaceChildren();

  const option =
    document.createElement("option");

  option.value = "";
  option.textContent =
    "Load a .sm file first";

  chartSelect.append(option);
  chartSelect.disabled = true;

  simfileStatus.textContent =
    "No .sm file loaded";

  chartStatus.textContent =
    "No chart selected";

  game.reset();
}

function handleChartSelection(): void {
  if (!loadedSimfile) {
    selectedChart = null;
    game.reset();
    updateButtonState();
    return;
  }

  const selectedIndex =
    Number.parseInt(
      chartSelect.value,
      10,
    );

  if (!Number.isInteger(selectedIndex)) {
    selectedChart = null;

    chartStatus.textContent =
      "No chart selected";

    game.reset();
    updateButtonState();

    return;
  }

  const chart =
    loadedSimfile.charts[selectedIndex];

  if (!chart) {
    selectedChart = null;

    chartStatus.textContent =
      "Selected chart could not be found";

    game.reset();
    updateButtonState();

    return;
  }

  try {
    loadGameChart(
      loadedSimfile,
      chart,
    );

    selectedChart = chart;

    chartStatus.textContent =
      `${chart.difficulty} — ` +
      `Meter ${chart.meter} — ` +
      `${chart.notes.length} parsed taps`;
  } catch (error) {
    console.error(error);

    selectedChart = null;
    game.reset();

    chartStatus.textContent =
      error instanceof Error
        ? error.message
        : "Could not build the chart.";
  }

  updateButtonState();
}

/* =========================================================
   GLOBAL SONGS DIRECTORY IMPORT
   ========================================================= */

async function handleLibraryFolderSelection(): Promise<void> {
  const files =
    libraryFolderInput.files;

  if (!files || files.length === 0) {
    return;
  }

  libraryFolderInput.disabled = true;

  libraryImportStatus.textContent =
    `Scanning ${files.length} files...`;

  try {
    const importedFiles =
      folderImporter.importFiles(files);

    const newLibrary =
      await libraryBuilder.build(
        importedFiles,
      );

    if (newLibrary.packs.length === 0) {
      libraryBuilder.releaseLibraryUrls(
        newLibrary,
      );

      throw new Error(
        "No playable StepMania packs were found in the selected folder.",
      );
    }

    /*
     * Do not release the old URLs until the replacement library has
     * successfully finished building.
     */
    if (loadedLibrary) {
      libraryBuilder.releaseLibraryUrls(
        loadedLibrary,
      );
    }

    loadedLibrary = newLibrary;

    selectedLibrarySong = null;
    selectedLibraryChart = null;

    libraryView.setLibrary(newLibrary);
    resetSelectedSongPanel();

    libraryImportStatus.textContent =
      `${newLibrary.packs.length} ${newLibrary.packs.length === 1
        ? "pack"
        : "packs"
      } · ` +
      `${newLibrary.totalSongs} songs · ` +
      `${newLibrary.skippedSongFolders} skipped`;

    if (newLibrary.warnings.length > 0) {
      console.warn(
        "Library import warnings:",
        newLibrary.warnings,
      );
    }

    console.log(
      "Imported library:",
      newLibrary,
    );

    viewManager.show(
      "pack-selection",
    );
  } catch (error) {
    console.error(error);

    libraryImportStatus.textContent =
      error instanceof Error
        ? error.message
        : "Could not import the selected folder.";
  } finally {
    libraryFolderInput.disabled = false;
  }
}

/* =========================================================
   LIBRARY SONG SELECTION
   ========================================================= */

function handleLibrarySongSelection(
  song: SongEntry,
): void {
  selectedLibrarySong = song;
  selectedLibraryChart = null;

  selectedSongPanel.hidden = false;

  selectedSongTitle.textContent =
    song.title;

  selectedSongArtist.textContent =
    song.artist;

  selectedSongPack.textContent =
    `Pack: ${song.packName}`;

  selectedSongBpm.textContent =
    formatBpmRange(
      song.simfile.bpmSegments.map(
        (segment) => segment.bpm,
      ),
    );

  if (song.bannerUrl) {
    selectedSongImage.src =
      song.bannerUrl;

    selectedSongImage.alt =
      `${song.title} banner`;

    selectedSongImage.hidden = false;
  } else {
    selectedSongImage.removeAttribute(
      "src",
    );

    selectedSongImage.alt = "";
    selectedSongImage.hidden = true;
  }

  populateLibraryChartSelect(song);

  libraryImportStatus.textContent =
    `Selected: ${song.title} — ${song.artist}`;
}

function populateLibraryChartSelect(
  song: SongEntry,
): void {
  libraryChartSelect.replaceChildren();

  const placeholder =
    document.createElement("option");

  placeholder.value = "";
  placeholder.textContent =
    "Select difficulty";

  libraryChartSelect.append(
    placeholder,
  );

  song.simfile.charts.forEach(
    (chart, index) => {
      const option =
        document.createElement("option");

      option.value =
        index.toString();

      option.textContent =
        `${chart.difficulty} · ` +
        `Meter ${chart.meter} · ` +
        `${chart.notes.length} taps`;

      libraryChartSelect.append(
        option,
      );
    },
  );

  libraryChartSelect.disabled =
    song.simfile.charts.length === 0;

  libraryChartSelect.value = "";

  playSelectedSongButton.disabled = true;
}

function handleLibraryChartSelection(): void {
  selectedLibraryChart = null;
  playSelectedSongButton.disabled = true;

  if (!selectedLibrarySong) {
    return;
  }

  const chartIndex =
    Number.parseInt(
      libraryChartSelect.value,
      10,
    );

  if (!Number.isInteger(chartIndex)) {
    return;
  }

  const chart =
    selectedLibrarySong.simfile
      .charts[chartIndex];

  if (!chart) {
    return;
  }

  selectedLibraryChart = chart;

  playSelectedSongButton.disabled =
    selectedLibrarySong.audioFile === null;
}

/* =========================================================
   LIBRARY SONG LAUNCH
   ========================================================= */

async function handlePlaySelectedSong(): Promise<void> {
  const song = selectedLibrarySong;
  const chart = selectedLibraryChart;

  if (!song || !chart) {
    return;
  }

  if (!song.audioFile) {
    libraryImportStatus.textContent =
      `${song.title} is missing its audio file.`;

    return;
  }

  playSelectedSongButton.disabled = true;

  try {
    audioClock.stop();

    await audioClock.loadFile(
      song.audioFile,
    );

    loadGameChart(
      song.simfile,
      chart,
    );

    loadedSimfile =
      song.simfile;

    selectedChart = chart;

    gameplayTitle.textContent =
      song.title;

    gameplaySongArtist.textContent =
      `${song.artist} · ${chart.difficulty} ` +
      `· Meter ${chart.meter}`;

    audioFileStatus.textContent =
      `${song.audioFile.name} — ` +
      formatTime(
        audioClock.getDurationSeconds(),
      );

    navGameButton.disabled = false;

    viewManager.show("gameplay");

    /*
     * Start immediately after selecting Play.
     */
    game.start();
    previousGameStatus = "playing";

    await audioClock.playFromStart();

    updateButtonState();
  } catch (error) {
    game.reset();
    reportAudioError(error);

    viewManager.show(
      "song-selection",
    );
  } finally {
    handleLibraryChartSelection();
  }
}

/* =========================================================
   SHARED CHART LOADING
   ========================================================= */

function loadGameChart(
  simfile: StepManiaSimfile,
  chart: StepManiaChart,
): void {
  const runtimeNotes =
    runtimeChartBuilder.build(
      simfile,
      chart,
    );

  if (runtimeNotes.length === 0) {
    throw new Error(
      "The selected chart has no supported tap notes.",
    );
  }

  game.loadChart(
    runtimeNotes.map((note) => ({
      lane: note.lane,
      hitTimeSeconds:
        note.hitTimeSeconds,
    })),
  );

  console.log(
    "Loaded runtime chart:",
    runtimeNotes,
  );
}

/* =========================================================
   GAMEPLAY CONTROLS
   ========================================================= */

async function handleStart(): Promise<void> {
  if (!game.hasChart()) {
    chartStatus.textContent =
      "Select a chart before starting.";

    return;
  }

  if (!audioClock.hasAudio()) {
    audioFileStatus.textContent =
      "Load the song audio before starting.";

    return;
  }

  try {
    game.start();
    previousGameStatus = "playing";

    await audioClock.playFromStart();
  } catch (error) {
    game.pause();
    reportAudioError(error);
  }
}

async function handlePauseToggle(): Promise<void> {
  try {
    const status =
      game.getState().status;

    if (status === "playing") {
      await audioClock.pause();
      game.pause();
      return;
    }

    if (status === "paused") {
      await audioClock.resume();
      game.resume();
    }
  } catch (error) {
    reportAudioError(error);
  }
}

async function handleRestart(): Promise<void> {
  try {
    game.restart();
    previousGameStatus = "playing";

    await audioClock.restart();
  } catch (error) {
    game.pause();
    reportAudioError(error);
  }
}

function exitGameplay(): void {
  audioClock.stop();
  game.reset();

  previousGameStatus =
    game.getState().status;

  if (selectedLibrarySong) {
    viewManager.show(
      "song-selection",
    );
  } else {
    viewManager.show(
      "library-import",
    );
  }
}

/* =========================================================
   RESULTS
   ========================================================= */

function showResults(): void {
  const score =
    game.getState().score;

  resultsScoreValue.textContent =
    score.score.toLocaleString();

  resultsPerfectCount.textContent =
    score.perfectCount.toString();

  resultsGreatCount.textContent =
    score.greatCount.toString();

  resultsGoodCount.textContent =
    score.goodCount.toString();

  resultsMissCount.textContent =
    score.missCount.toString();

  resultsMaxCombo.textContent =
    score.maxCombo.toString();

  audioClock.stop();

  viewManager.show("results");
}

/* =========================================================
   UI HELPERS
   ========================================================= */

function resetSelectedSongPanel(): void {
  selectedSongPanel.hidden = true;

  selectedSongTitle.textContent =
    "No song selected";

  selectedSongArtist.textContent =
    "Unknown artist";

  selectedSongBpm.textContent =
    "BPM —";

  selectedSongPack.textContent =
    "Pack —";

  selectedSongImage.removeAttribute("src");
  selectedSongImage.alt = "";
  selectedSongImage.hidden = true;

  libraryChartSelect.replaceChildren();

  const option =
    document.createElement("option");

  option.value = "";
  option.textContent =
    "Select a song first";

  libraryChartSelect.append(option);
  libraryChartSelect.disabled = true;

  playSelectedSongButton.disabled = true;
}

function formatBpmRange(
  bpmValues: readonly number[],
): string {
  const validValues =
    bpmValues.filter(
      (bpm) =>
        Number.isFinite(bpm) &&
        bpm > 0,
    );

  if (validValues.length === 0) {
    return "BPM —";
  }

  const minimum =
    Math.min(...validValues);

  const maximum =
    Math.max(...validValues);

  if (
    Math.abs(maximum - minimum) <
    0.001
  ) {
    return `BPM ${minimum.toFixed(0)}`;
  }

  return (
    `BPM ${minimum.toFixed(0)}` +
    `–${maximum.toFixed(0)}`
  );
}

function formatTime(
  totalSeconds: number,
): string {
  const minutes =
    Math.floor(totalSeconds / 60);

  const seconds =
    Math.floor(totalSeconds % 60);

  return (
    `${minutes}:` +
    seconds
      .toString()
      .padStart(2, "0")
  );
}

function reportAudioError(
  error: unknown,
): void {
  console.error(error);

  audioFileStatus.textContent =
    error instanceof Error
      ? error.message
      : "An audio error occurred.";
}

/* =========================================================
   VIEW NAVIGATION
   ========================================================= */

const unsubscribeFromViewChanges =
  viewManager.subscribe(
    (currentView) => {
      const libraryActive =
        currentView === "library-import" ||
        currentView === "pack-selection" ||
        currentView === "song-selection";

      navLibraryButton.classList.toggle(
        "navigation-button--active",
        libraryActive,
      );

      navGameButton.classList.toggle(
        "navigation-button--active",
        currentView === "gameplay",
      );

      if (currentView === "gameplay") {
        /*
         * A canvas inside a hidden parent may previously have had
         * zero dimensions.
         */
        requestAnimationFrame(() => {
          renderer.resize();
        });
      }
    },
  );

/* =========================================================
   RESIZE AND CLEANUP
   ========================================================= */

function handleResize(): void {
  if (viewManager.isShowing("gameplay")) {
    renderer.resize();
  }
}

function cleanUp(): void {
  cancelAnimationFrame(
    animationFrameId,
  );

  input.destroy();
  audioClock.destroy();

  unsubscribeFromViewChanges();

  if (loadedLibrary) {
    libraryBuilder.releaseLibraryUrls(
      loadedLibrary,
    );
  }

  window.removeEventListener(
    "resize",
    handleResize,
  );

  window.removeEventListener(
    "beforeunload",
    cleanUp,
  );
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */

libraryFolderInput.addEventListener(
  "change",
  () => {
    void handleLibraryFolderSelection();
  },
);

simfileInput.addEventListener(
  "change",
  () => {
    void handleSimfileSelection();
  },
);

chartSelect.addEventListener(
  "change",
  handleChartSelection,
);

audioFileInput.addEventListener(
  "change",
  () => {
    void handleAudioSelection();
  },
);

libraryChartSelect.addEventListener(
  "change",
  handleLibraryChartSelection,
);

playSelectedSongButton.addEventListener(
  "click",
  () => {
    void handlePlaySelectedSong();
  },
);

startButton.addEventListener(
  "click",
  () => {
    void handleStart();
  },
);

pauseButton.addEventListener(
  "click",
  () => {
    void handlePauseToggle();
  },
);

restartButton.addEventListener(
  "click",
  () => {
    void handleRestart();
  },
);

backToPacksButton.addEventListener(
  "click",
  () => {
    selectedLibrarySong = null;
    selectedLibraryChart = null;

    resetSelectedSongPanel();

    viewManager.show(
      "pack-selection",
    );
  },
);

importAnotherLibraryButton.addEventListener(
  "click",
  () => {
    viewManager.show(
      "library-import",
    );
  },
);

navLibraryButton.addEventListener(
  "click",
  () => {
    if (loadedLibrary) {
      viewManager.show(
        "pack-selection",
      );
    } else {
      viewManager.show(
        "library-import",
      );
    }
  },
);

navGameButton.addEventListener(
  "click",
  () => {
    if (
      game.hasChart() &&
      audioClock.hasAudio()
    ) {
      viewManager.show(
        "gameplay",
      );
    }
  },
);

exitGameButton.addEventListener(
  "click",
  exitGameplay,
);

resultsReplayButton.addEventListener(
  "click",
  () => {
    viewManager.show(
      "gameplay",
    );

    void handleRestart();
  },
);

resultsSongSelectButton.addEventListener(
  "click",
  () => {
    game.reset();
    audioClock.stop();

    viewManager.show(
      "song-selection",
    );
  },
);

window.addEventListener(
  "resize",
  handleResize,
);

window.addEventListener(
  "beforeunload",
  cleanUp,
);

/* =========================================================
   INITIALIZATION
   ========================================================= */

resetSelectedSongPanel();
updateButtonState();

viewManager.show(
  "library-import",
);

animationFrameId =
  requestAnimationFrame(gameLoop);