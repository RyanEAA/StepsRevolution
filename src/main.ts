import "./style.css";

import { Game } from "./game/Game";
import { KeyboardInput } from "./input/KeyboardInput";
import { CanvasRenderer } from "./rendering/CanvasRenderer";

const canvas =
    document.querySelector<HTMLCanvasElement>("#game-canvas");

const startButton =
    document.querySelector<HTMLButtonElement>("#start-button")!;

const pauseButton =
    document.querySelector<HTMLButtonElement>("#pause-button")!;

const restartButton =
    document.querySelector<HTMLButtonElement>("#restart-button")!;

if (!canvas) {
    throw new Error(
        'Could not find a canvas element with the ID "game-canvas".',
    );
}

if (!startButton || !pauseButton || !restartButton) {
    throw new Error(
        "Could not find one or more game control buttons.",
    );
}

const input = new KeyboardInput();
const renderer = new CanvasRenderer(canvas);
const game = new Game();

let previousFrameTimeMs = performance.now();
let animationFrameId = 0;
let smoothedFramesPerSecond = 60;

function gameLoop(currentFrameTimeMs: number): void {
    const rawDeltaSeconds =
        (currentFrameTimeMs - previousFrameTimeMs) / 1000;

    const deltaSeconds = Math.min(rawDeltaSeconds, 0.1);

    previousFrameTimeMs = currentFrameTimeMs;

    input.update(deltaSeconds);

    const footState = input.getFootState();

    game.update(
        deltaSeconds,
        footState,
    );

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

    startButton.disabled =
        gameStatus === "playing" ||
        gameStatus === "paused";

    pauseButton.disabled =
        gameStatus === "idle" ||
        gameStatus === "finished";

    pauseButton.textContent =
        gameStatus === "paused"
            ? "Resume"
            : "Pause";
}

function handleResize(): void {
    renderer.resize();
}

function cleanUp(): void {
    cancelAnimationFrame(animationFrameId);
    input.destroy();

    window.removeEventListener("resize", handleResize);
    window.removeEventListener("beforeunload", cleanUp);
}

startButton.addEventListener("click", () => {
    game.start();
});

pauseButton.addEventListener("click", () => {
    game.togglePause();
});

restartButton.addEventListener("click", () => {
    game.restart();
});

window.addEventListener("resize", handleResize);
window.addEventListener("beforeunload", cleanUp);

updateButtonState();

animationFrameId = requestAnimationFrame(gameLoop);