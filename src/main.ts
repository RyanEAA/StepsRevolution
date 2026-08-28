import "./style.css";

import { ViewManager } from "./app/ViewManager";
import { NavigationController } from "./app/NavigationController";
import { AudioClock } from "./audio/AudioClock";
import { Game } from "./game/Game";
import { FolderImporter } from "./library/FolderImporter";
import { LibraryBuilder } from "./library/LibraryBuilder";
import { ChartAvailabilityIndex } from "./library/ChartAvailabilityIndex";
import { CameraFootInput } from "./camera/CameraFootInput";
import { CameraManager } from "./camera/CameraManager";
import { InputManager } from "./input/InputManager";
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
import { GameDebugPanel } from "./ui/GameDebugPanel";
import { CameraTrackingDebugPanel } from "./ui/CameraTrackingDebugPanel";
import { GameLoop } from "./loop/GameLoop";
import { CameraController } from "./controllers/CameraController";
import { SongSelectionController } from "./controllers/SongSelectionController";
import { GameplayController } from "./controllers/GameplayController";
import { SongDialogView } from "./ui/SongDialogView";
import { renderAppShell } from "./ui/renderAppShell";
import { LocalSession } from "./session/LocalSession";
import { SessionManager } from "./session/SessionManager";
import { MultiplayerClient } from "./multiplayer/MultiplayerClient";
import { ReconnectCredentialStore } from "./multiplayer/ReconnectCredentialStore";
import { RoomSession } from "./multiplayer/RoomSession";
import { MultiplayerView } from "./ui/MultiplayerView";
import { MultiplayerController } from "./controllers/MultiplayerController";
import { SharedRoomPreviewController } from "./controllers/SharedRoomPreviewController";
import { RelayAssetClient } from "./multiplayer/RelayAssetClient";
import { RoomPreviewView } from "./ui/RoomPreviewView";
import { SharedSongPackageController } from "./controllers/SharedSongPackageController";
import { MultiplayerStartController } from "./controllers/MultiplayerStartController";
import { MultiplayerScoreController } from "./controllers/MultiplayerScoreController";
import { MultiplayerScoreView } from "./ui/MultiplayerScoreView";
import { SettingsStore } from "./settings/SettingsStore";
import { SettingsController } from "./settings/SettingsController";
import { CalibrationController } from "./calibration/CalibrationController";

renderAppShell();

const settingsStore = new SettingsStore();

const localSession = new LocalSession();
const sessionManager = new SessionManager(localSession);
const configuredMultiplayerServerUrl =
  import.meta.env.VITE_MULTIPLAYER_SERVER_URL?.trim();

const multiplayerServerUrl =
  configuredMultiplayerServerUrl ||
  (import.meta.env.PROD
    ? window.location.origin
    : "http://localhost:3001");

const multiplayerClient = new MultiplayerClient({
  serverUrl: multiplayerServerUrl,
});
const roomSession = new RoomSession({
  client: multiplayerClient,
  credentialStore: new ReconnectCredentialStore(sessionStorage),
});
const relayAssetClient = new RelayAssetClient(multiplayerServerUrl, roomSession);

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

const gameDebugPanel =
  new GameDebugPanel(document, (visible) => {
    settingsStore.update((settings) => ({
      ...settings,
      interface: { ...settings.interface, showDiagnostics: visible },
    }));
  });

const cameraTrackingDebugPanel =
  new CameraTrackingDebugPanel();

const gameContainer =
  requireElement<HTMLElement>(
    ".game-container",
  );

const playfieldWidthInput =
  requireElement<HTMLInputElement>(
    "#playfield-width-input",
  );

const playfieldWidthValue =
  requireElement<HTMLOutputElement>(
    "#playfield-width-value",
  );


/* =========================================================
   MAIN VIEWS
   ========================================================= */

const mainMenuView =
  requireElement<HTMLElement>("#main-menu-view");

const settingsView =
  requireElement<HTMLElement>("#settings-view");

const calibrationView =
  requireElement<HTMLElement>("#calibration-view");

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

const multiplayerLobbyView =
  requireElement<HTMLElement>("#multiplayer-lobby-view");

/* =========================================================
   MENU NAVIGATION
   ========================================================= */

const mainMenuSettingsButton =
  requireElement<HTMLButtonElement>("#main-menu-settings-button");

const backFromLibraryImportButton =
  requireElement<HTMLButtonElement>(
    "#back-from-library-import-button",
  );

const backFromPacksButton =
  requireElement<HTMLButtonElement>(
    "#back-from-packs-button",
  );

const importAnotherLibraryButton =
  requireElement<HTMLButtonElement>(
    "#import-another-library-button",
  );

const backToPacksButton =
  requireElement<HTMLButtonElement>(
    "#back-to-packs-button",
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
   GAMEPLAY
   ========================================================= */

const canvas =
  requireElement<HTMLCanvasElement>(
    "#game-canvas",
  );

const cameraPreview =
  requireElement<HTMLVideoElement>(
    "#camera-preview",
  );


/* =========================================================
    POSE TRACKING
    ========================================================= */
const poseOverlayCanvas =
  requireElement<HTMLCanvasElement>(
    "#pose-overlay-canvas",
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
  "main-menu": mainMenuView,
  settings: settingsView,
  calibration: calibrationView,
  "library-import": libraryImportView,
  "pack-selection": packSelectionView,
  "song-selection": songSelectionView,
  "multiplayer-lobby": multiplayerLobbyView,
  gameplay: gameplayView,
  results: resultsView,
});

const navigationController = new NavigationController(viewManager);

const keyboardInput = new KeyboardInput();
const cameraManager = new CameraManager(cameraPreview);
const cameraInput = new CameraFootInput(
  cameraManager,
  poseOverlayCanvas,
); const input = new InputManager(
  keyboardInput,
  cameraInput,
);
const cameraController = new CameraController(
  input,
  cameraManager,
  cameraInput,
  settingsStore,
);
const renderer = new CanvasRenderer(canvas);

const gameContainerResizeObserver =
  new ResizeObserver(() => {
    if (
      viewManager.isShowing(
        "gameplay",
      )
    ) {
      renderer.resize();
      gameLoop.requestRender();
    }
  });

gameContainerResizeObserver.observe(
  gameContainer,
);

const game = new Game();
const audioClock = new AudioClock();
const multiplayerScoreController = new MultiplayerScoreController(roomSession, game);
const multiplayerScoreView = new MultiplayerScoreView();
multiplayerScoreController.initialize();

const simfileParser = new SimfileParser();
const runtimeChartBuilder = new RuntimeChartBuilder();

const folderImporter = new FolderImporter();
const libraryBuilder = new LibraryBuilder();
const chartAvailabilityIndex =
  new ChartAvailabilityIndex();

/* =========================================================
   APPLICATION STATE
   ========================================================= */

let loadedSimfile: StepManiaSimfile | null = null;
let loadedLibrary: SongLibrary | null = null;

let gameplayController: GameplayController;
let multiplayerController: MultiplayerController;
let sharedRoomPreviewController: SharedRoomPreviewController;
let sharedSongPackageController: SharedSongPackageController;
let multiplayerStartController: MultiplayerStartController;

const gameLoop = new GameLoop({
  input,
  cameraInput,
  game,
  audioClock,
  renderer,
  viewManager,
  gameDebugPanel,
  cameraTrackingDebugPanel,
  onGameFinished: () => gameplayController.showResults(),
  onGameStatusChanged: () => gameplayController.updateButtonState(),
});

/* =========================================================
   LIBRARY / SONG SELECTION
   ========================================================= */

const songDialogView = new SongDialogView();

let songSelectionController: SongSelectionController;

const libraryView = new LibraryView(
  packCardContainer,
  songCardContainer,
  songSectionTitle,
  {
    onPackSelected(pack: SongPack): void {
      songSelectionController.handlePackSelected();

      console.log("Selected pack:", pack);

      viewManager.show("song-selection");
    },

    onSongSelected(song: SongEntry): void {
      songSelectionController.selectSong(song);
    },
  },
);

songSelectionController = new SongSelectionController(
  songDialogView,
  libraryView,
  {
    onPlaySong(song: SongEntry, chart: StepManiaChart): void {
      if (sessionManager.getActiveSession().kind === "online") {
        multiplayerController.selectChartForRoom(song, chart);
      } else {
        void gameplayController.launchLibrarySong(song, chart);
      }
    },
    onPreviewOpened(song: SongEntry): void {
      if (sessionManager.getActiveSession().kind === "online") {
        void sharedRoomPreviewController.publishSong(song);
      }
    },
    onPreviewClosed(): void {
      if (sessionManager.getActiveSession().kind === "online") {
        void sharedRoomPreviewController.clearPublishedPreview();
      }
    },
    onConfirmSong(song: SongEntry): void {
      if (sessionManager.getActiveSession().kind === "online") {
        viewManager.show("multiplayer-lobby");
        void sharedSongPackageController.confirmSong(song);
      }
    },
  },
);

songSelectionController.initialize();

gameplayController = new GameplayController({
  game,
  audioClock,
  gameLoop,
  viewManager,
  runtimeChartBuilder,
  sessionManager,
  callbacks: {
    closeSongDialog: () => songSelectionController.closeDialog(),
    hasLoadedLibrary: () => loadedLibrary !== null,
    hasSelectedPack: () => libraryView.getSelectedPack() !== null,
    stopCamera: () => cameraController.stopCamera(),
    prepareInputForGameplay: () => cameraController.prepareForGameplay(),
    reportOnlineFinished: async () => {
      const room = roomSession.getState().room;
      if (!room) throw new Error("The multiplayer room is unavailable.");
      const state = game.getState();
      const result = {
        selectionRevision: room.selectionRevision,
        sequence: multiplayerScoreController.nextSequence(),
        score: state.score.score,
        combo: state.score.combo,
        maxCombo: state.score.maxCombo,
        perfectCount: state.score.perfectCount,
        greatCount: state.score.greatCount,
        goodCount: state.score.goodCount,
        missCount: state.score.missCount,
        gameTimeSeconds: state.gameTimeSeconds,
        finishedAtServerMs: Date.now(),
      };

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const sessionState = roomSession.getState();
        const localPlayer = sessionState.room?.players.find(
          (player) => player.playerId === sessionState.localPlayerId,
        );
        if (localPlayer?.finalResult) return;

        try {
          await roomSession.reportGameFinished(result);
        } catch (error) {
          if (attempt === 4) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const latest = roomSession.getState();
      const reflected = latest.room?.players.find(
        (player) => player.playerId === latest.localPlayerId,
      )?.finalResult;
      if (!reflected) {
        throw new Error("The server did not confirm the final result. Check the room server connection.");
      }
    },
    handleOnlineReplay: async () => {
      const state = roomSession.getState();
      const room = state.room;
      if (!room || !state.localPlayerId) throw new Error("The multiplayer room is unavailable.");
      const connected = room.players.filter((player) => player.connectionStatus === "connected");
      const everyoneRequested = connected.every((player) => player.replayRequested);
      if (room.hostPlayerId === state.localPlayerId && everyoneRequested) {
        await roomSession.confirmReplay();
      } else {
        await roomSession.voteReplay(true);
      }
    },
    handleOnlineChooseSong: async () => {
      await roomSession.returnToSelection();
    },
  },
});

gameplayController.initialize();

const multiplayerView = new MultiplayerView();
sharedSongPackageController = new SharedSongPackageController(
  roomSession,
  relayAssetClient,
  (message) => multiplayerView.setSelectionStatus(message),
  {
    prepare: (songPackage, chart, runtime, audio) =>
      gameplayController.prepareOnlineSong(songPackage, chart, runtime, audio),
    clear: () => gameplayController.clearOnlinePreparation(),
  },
);
sharedSongPackageController.initialize();
multiplayerStartController = new MultiplayerStartController(
  roomSession,
  {
    scheduleOnlineStart: (deadline) => gameplayController.scheduleOnlineStart(deadline),
    cancelOnlineStart: (returnToLobby) => gameplayController.cancelOnlineStart(returnToLobby),
  },
  (message) => multiplayerView.setReadyStatus(message),
);
multiplayerStartController.initialize();

const unsubscribeOnlineResults = roomSession.subscribe((state) => {
  multiplayerScoreView.render(state.room, state.localPlayerId);
  const room = state.room;
  if (!room || !state.localPlayerId) return;
  const local = room.players.find((player) => player.playerId === state.localPlayerId);
  const connected = room.players.filter((player) => player.connectionStatus === "connected");
  gameplayController.renderOnlineResults({
    roomInResults: room.phase === "results",
    isHost: room.hostPlayerId === state.localPlayerId,
    localReplayRequested: local?.replayRequested ?? false,
    everyoneRequestedReplay: connected.length > 0 && connected.every((player) => player.replayRequested),
  });
});
multiplayerController = new MultiplayerController({
  roomSession,
  sessionManager,
  viewManager,
  view: multiplayerView,
  getSinglePlayerDestination: () =>
    loadedLibrary ? "pack-selection" : "library-import",
  setRoomSelectionMode: (enabled) =>
    songSelectionController.setRoomSelectionMode(enabled),
  checkAvailability: (selection) =>
    chartAvailabilityIndex.checkSelection(selection),
  selectDifficulty: (chartId) =>
    sharedSongPackageController.selectDifficulty(chartId),
  retrySongPreparation: () =>
    sharedSongPackageController.retryPreparation(),
  requestCountdown: () => roomSession.requestCountdown(),
  unlockOnlineAudio: () => gameplayController.unlockOnlineAudio(),
});
multiplayerController.initialize();

sharedRoomPreviewController = new SharedRoomPreviewController(
  roomSession,
  relayAssetClient,
  new RoomPreviewView(),
);
sharedRoomPreviewController.initialize();

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
    await gameplayController.loadDeveloperAudio(file);
  } catch (error) {
    gameplayController.reportAudioError(error);
  } finally {
    audioFileInput.disabled = false;
    gameplayController.updateButtonState();
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

    populateDeveloperChartSelect(
      simfile,
    );

    simfileStatus.textContent =
      `${simfile.title} — ` +
      `${simfile.artist}`;

    chartStatus.textContent =
      `${simfile.charts.length} ` +
      "difficulties available";

    gameplayController.stopForSimfileChange();
  } catch (error) {
    console.error(error);

    clearLoadedSimfile();

    simfileStatus.textContent =
      error instanceof Error
        ? error.message
        : "Could not parse the .sm file.";
  } finally {
    simfileInput.disabled = false;
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

  gameplayController.resetGame();
}

function handleChartSelection(): void {
  if (!loadedSimfile) {
    gameplayController.resetGame();
    return;
  }

  const selectedIndex =
    Number.parseInt(
      chartSelect.value,
      10,
    );

  if (!Number.isInteger(selectedIndex)) {

    chartStatus.textContent =
      "No chart selected";

    gameplayController.resetGame();

    return;
  }

  const chart =
    loadedSimfile.charts[selectedIndex];

  if (!chart) {

    chartStatus.textContent =
      "Selected chart could not be found";

    gameplayController.resetGame();

    return;
  }

  try {
    gameplayController.loadChart(
      loadedSimfile,
      chart,
    );


    chartStatus.textContent =
      `${chart.difficulty} — ` +
      `Meter ${chart.meter} — ` +
      `${chart.notes.length} parsed taps`;
  } catch (error) {
    console.error(error);

    gameplayController.resetGame();

    chartStatus.textContent =
      error instanceof Error
        ? error.message
        : "Could not build the chart.";
  }

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
    chartAvailabilityIndex.rebuild(newLibrary);
    multiplayerController.handleLibraryChanged();

    songSelectionController.clearSelection();
    libraryView.setLibrary(newLibrary);

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
   VIEW NAVIGATION
   ========================================================= */

const unsubscribeFromViewChanges =
  viewManager.subscribe(
    (currentView) => {
      if (currentView === "gameplay") {
        /*
         * A canvas inside a hidden parent may previously have had
         * zero dimensions.
         */
        requestAnimationFrame(() => {
          renderer.resize();
          gameLoop.requestRender();
        });
      }

      if (currentView === "settings") {
        void settingsController?.refreshCameraList();
      }
    },
  );

/* =========================================================
   RESIZE AND CLEANUP
   ========================================================= */

function handleResize(): void {
  if (viewManager.isShowing("gameplay")) {
    renderer.resize();
    gameLoop.requestRender();
  }
}

function cleanUp(): void {
  gameDebugPanel.destroy();

  gameLoop.stop();

  calibrationController.destroy();
  settingsController.destroy();
  unsubscribeSettings();
  cameraController.destroy();
  gameplayController.destroy();
  multiplayerController.destroy();
  sharedRoomPreviewController.destroy();
  sharedSongPackageController.destroy();
  multiplayerStartController.destroy();
  multiplayerScoreController.destroy();
  unsubscribeOnlineResults();
  roomSession.destroy();
  input.destroy();
  audioClock.destroy();

  unsubscribeFromViewChanges();

  if (loadedLibrary) {
    libraryBuilder.releaseLibraryUrls(
      loadedLibrary,
    );
  }

  chartAvailabilityIndex.clear();

  window.removeEventListener(
    "resize",
    handleResize,
  );

  window.removeEventListener(
    "beforeunload",
    cleanUp,
  );

  songSelectionController.destroy();

  gameContainerResizeObserver.disconnect();
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

backFromLibraryImportButton.addEventListener(
  "click",
  () => {
    songSelectionController.closeDialog();
    const activeSession = sessionManager.getActiveSession();

    if (activeSession.kind === "online" && roomSession.getState().room) {
      viewManager.show("multiplayer-lobby");
      return;
    }

    viewManager.show(loadedLibrary ? "pack-selection" : "main-menu");
  },
);

backFromPacksButton.addEventListener(
  "click",
  () => {
    songSelectionController.clearSelection();
    songSelectionController.closeDialog();

    const activeSession = sessionManager.getActiveSession();
    if (activeSession.kind === "online" && roomSession.getState().room) {
      viewManager.show("multiplayer-lobby");
      return;
    }

    navigationController.reset("main-menu");
  },
);

backToPacksButton.addEventListener(
  "click",
  () => {
    songSelectionController.clearSelection();

    viewManager.show(
      "pack-selection",
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

importAnotherLibraryButton.addEventListener(
  "click",
  () => {
    songSelectionController.clearSelection();
    libraryView.collapseExpandedSong();

    viewManager.show(
      "library-import",
    );
  },
);

playfieldWidthInput.addEventListener(
  "input",
  () => {
    const width = Number.parseInt(playfieldWidthInput.value, 10);
    if (!Number.isFinite(width)) return;
    settingsStore.update((settings) => ({
      ...settings,
      gameplay: { ...settings.gameplay, playfieldWidth: width },
    }));
  },
);


/* =========================================================
   INITIALIZATION
   ========================================================= */

cameraController.initialize();

const calibrationController = new CalibrationController({
  cameraManager,
  cameraInput,
  settingsStore,
  onBack: () => viewManager.show("settings"),
});
calibrationController.initialize();

const settingsController = new SettingsController({
  store: settingsStore,
  cameraManager,
  onBack: () => navigationController.back("main-menu"),
  onOpenCalibration: () => {
    calibrationController.enter();
    viewManager.show("calibration");
  },
});
settingsController.initialize();

mainMenuSettingsButton.addEventListener("click", () => {
  navigationController.navigate("settings");
});

const cameraTrackingDebugElement = requireElement<HTMLElement>(".camera-tracking-debug");
const unsubscribeSettings = settingsStore.subscribe((settings) => {
  const width = settings.gameplay.playfieldWidth;
  gameContainer.style.setProperty("--playfield-width", `${width}px`);
  playfieldWidthInput.value = width.toString();
  playfieldWidthValue.value = `${width} px`;
  gameDebugPanel.setVisible(settings.interface.showDiagnostics, false);
  cameraTrackingDebugElement.hidden = !settings.interface.showDiagnostics;
  document.documentElement.classList.toggle("reduced-motion", settings.interface.reducedMotion);
});

navigationController.reset("main-menu");

gameLoop.start();

gameDebugPanel.initialize(settingsStore.get().interface.showDiagnostics);
