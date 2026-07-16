import "./style.css";


import { AudioClock } from "./audio/AudioClock";
import { Game } from "./game/Game";
import { KeyboardInput } from "./input/KeyboardInput";
import { CanvasRenderer } from "./rendering/CanvasRenderer";
import { RuntimeChartBuilder } from "./stepmania/RuntimeChartBuilder";
import { SimfileParser } from "./stepmania/SimfileParser";
import type { StepManiaChart, StepManiaSimfile } from "./types/Chart";



const canvas =
  document.querySelector<HTMLCanvasElement>("#game-canvas")!;

const audioFileInput =
  document.querySelector<HTMLInputElement>("#audio-file-input")!;

const audioFileStatus =
  document.querySelector<HTMLSpanElement>("#audio-file-status")!;

const startButton =
  document.querySelector<HTMLButtonElement>("#start-button")!;

const pauseButton =
  document.querySelector<HTMLButtonElement>("#pause-button")!;

const restartButton =
  document.querySelector<HTMLButtonElement>("#restart-button")!;

const simfileInput =
  document.querySelector<HTMLInputElement>(
    "#simfile-input",
  )!;

const simfileStatus =
  document.querySelector<HTMLSpanElement>(
    "#simfile-status",
  )!;

const chartSelect =
  document.querySelector<HTMLSelectElement>(
    "#chart-select",
  )!;

const chartStatus =
  document.querySelector<HTMLSpanElement>(
    "#chart-status",
  )!;


const input = new KeyboardInput();
const renderer = new CanvasRenderer(canvas);
const game = new Game();
const audioClock = new AudioClock();

let previousFrameTimeMs = performance.now();
let animationFrameId = 0;
let smoothedFramesPerSecond = 60;

const simfileParser = new SimfileParser();
const runtimeChartBuilder = new RuntimeChartBuilder();

let loadedSimfile:
  StepManiaSimfile | null = null;

let selectedChart:
  StepManiaChart | null = null;

function gameLoop(currentFrameTimeMs: number): void {
  const rawDeltaSeconds =
    (currentFrameTimeMs - previousFrameTimeMs) / 1000;

  const deltaSeconds = Math.min(
    rawDeltaSeconds,
    0.1,
  );

  previousFrameTimeMs = currentFrameTimeMs;

  input.update(deltaSeconds);

  const footState = input.getFootState();

  if (game.getState().status === "playing") {
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

  renderer.render(
    footState,
    game.getVisibleNotes(),
    gameState,
    smoothedFramesPerSecond,
  );

  updateButtonState();

  animationFrameId = requestAnimationFrame(gameLoop);
}

function updateButtonState(): void {
  const gameStatus =
    game.getState().status;

  const canStart =
    audioClock.hasAudio() &&
    game.hasChart();

  startButton.disabled =
    !canStart ||
    gameStatus === "playing" ||
    gameStatus === "paused";

  pauseButton.disabled =
    !canStart ||
    gameStatus === "idle" ||
    gameStatus === "finished";

  restartButton.disabled =
    !canStart;

  pauseButton.textContent =
    gameStatus === "paused"
      ? "Resume"
      : "Pause";
}

async function handleAudioSelection(): Promise<void> {
  const file = audioFileInput.files?.[0];

  if (!file) {
    audioFileStatus.textContent =
      "No audio loaded";

    return;
  }

  audioFileStatus.textContent =
    `Loading ${file.name}...`;

  audioFileInput.disabled = true;

  try {
    await audioClock.loadFile(file);

    audioFileStatus.textContent =
      `${file.name} — ${formatTime(
        audioClock.getDurationSeconds(),
      )}`;

    game.reset();
  } catch (error) {
    console.error(error);

    audioFileStatus.textContent =
      error instanceof Error
        ? error.message
        : "Unable to load audio.";
  } finally {
    audioFileInput.disabled = false;
    updateButtonState();
    game.reset();
  }
}

async function handleStart(): Promise<void> {
  if (!loadedSimfile || !selectedChart) {
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
    await audioClock.playFromStart();
  } catch (error) {
    game.pause();
    reportAudioError(error);
  }
}

async function handlePauseToggle(): Promise<void> {
  try {
    const status = game.getState().status;

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
    await audioClock.restart();
  } catch (error) {
    game.pause();
    reportAudioError(error);
  }
}

function reportAudioError(error: unknown): void {
  console.error(error);

  audioFileStatus.textContent =
    error instanceof Error
      ? error.message
      : "An audio error occurred.";
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);

  return `${minutes}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function handleResize(): void {
  renderer.resize();
}

function cleanUp(): void {
  cancelAnimationFrame(animationFrameId);

  input.destroy();
  audioClock.destroy();

  window.removeEventListener(
    "resize",
    handleResize,
  );

  window.removeEventListener(
    "beforeunload",
    cleanUp,
  );
}

audioFileInput.addEventListener(
  "change",
  () => {
    void handleAudioSelection();
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

window.addEventListener(
  "resize",
  handleResize,
);

window.addEventListener(
  "beforeunload",
  cleanUp,
);

chartSelect.addEventListener(
  "change",
  handleChartSelection,
);

updateButtonState();

animationFrameId = requestAnimationFrame(gameLoop);

async function handleSimfileSelection(): Promise<void> {
  const file =
    simfileInput.files?.[0];

  if (!file) {
    clearLoadedSimfile();
    return;
  }

  simfileStatus.textContent =
    `Loading ${file.name}...`;

  simfileInput.disabled = true;

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

    populateChartSelect(simfile);

    simfileStatus.textContent =
      `${simfile.title} — ${simfile.artist}`;

    chartStatus.textContent =
      `${simfile.charts.length} difficulties available`;

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

function populateChartSelect(
  simfile: StepManiaSimfile,
): void {
  chartSelect.innerHTML = "";

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

  chartSelect.innerHTML = `
        <option value="">
            Load a .sm file first
        </option>
    `;

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
    const runtimeNotes =
      runtimeChartBuilder.build(
        loadedSimfile,
        chart,
      );

    if (runtimeNotes.length === 0) {
      throw new Error(
        "The selected chart has no supported tap notes.",
      );
    }

    selectedChart = chart;

    game.loadChart(
      runtimeNotes.map((note) => ({
        lane: note.lane,
        hitTimeSeconds:
          note.hitTimeSeconds,
      })),
    );

    chartStatus.textContent =
      `${chart.difficulty} — ` +
      `Meter ${chart.meter} — ` +
      `${runtimeNotes.length} notes`;

    console.log(
      "Loaded runtime chart:",
      runtimeNotes,
    );
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

simfileInput.addEventListener(
  "change",
  () => {
    void handleSimfileSelection();
  },
);

