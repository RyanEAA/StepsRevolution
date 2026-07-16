import "./style.css";

import { KeyboardInput } from "./input/KeyboardInput";
import { CanvasRenderer } from "./rendering/CanvasRenderer";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");

if (!canvas) {
    throw new Error(
        'Could not find a canvas element with the ID "game-canvas".',
    );
}

const input = new KeyboardInput();
const renderer = new CanvasRenderer(canvas);

let previousFrameTimeMs = performance.now();
let animationFrameId = 0;

let smoothedFramesPerSecond = 60;

function gameLoop(currentFrameTimeMs: number): void {
    const rawDeltaSeconds =
        (currentFrameTimeMs - previousFrameTimeMs) / 1000;

    /*
     * Limiting delta time prevents very large movement jumps when the page
     * resumes after being hidden or paused by browser developer tools.
     */
    const deltaSeconds = Math.min(rawDeltaSeconds, 0.1);

    previousFrameTimeMs = currentFrameTimeMs;

    input.update(deltaSeconds);

    const currentFramesPerSecond =
        deltaSeconds > 0
            ? 1 / deltaSeconds
            : smoothedFramesPerSecond;

    /*
     * Smooth the displayed FPS so it remains readable.
     * This does not affect movement or game timing.
     */
    smoothedFramesPerSecond =
        smoothedFramesPerSecond * 0.9 +
        currentFramesPerSecond * 0.1;

    const footState = input.getFootState();

    renderer.render(
        footState,
        smoothedFramesPerSecond,
    );

    animationFrameId = requestAnimationFrame(gameLoop);
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

window.addEventListener("resize", handleResize);
window.addEventListener("beforeunload", cleanUp);

animationFrameId = requestAnimationFrame(gameLoop);