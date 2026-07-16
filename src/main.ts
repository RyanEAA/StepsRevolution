import "./style.css";

import { AudioClock } from "./audio/AudioClock";
import { Game } from "./game/Game";
import { KeyboardInput } from "./input/KeyboardInput";
import { CanvasRenderer } from "./rendering/CanvasRenderer";

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

const input = new KeyboardInput();
const renderer = new CanvasRenderer(canvas);
const game = new Game();
const audioClock = new AudioClock();

let previousFrameTimeMs = performance.now();
let animationFrameId = 0;
let smoothedFramesPerSecond = 60;

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
    const gameStatus = game.getState().status;
    const audioLoaded = audioClock.hasAudio();

    startButton.disabled =
        !audioLoaded ||
        gameStatus === "playing" ||
        gameStatus === "paused";

    pauseButton.disabled =
        !audioLoaded ||
        gameStatus === "idle" ||
        gameStatus === "finished";

    restartButton.disabled = !audioLoaded;

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
    }
}

async function handleStart(): Promise<void> {
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

updateButtonState();

animationFrameId = requestAnimationFrame(gameLoop);