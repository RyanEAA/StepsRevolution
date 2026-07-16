import type { InputSource } from "./InputSource";
import type { FootState } from "../types/FootState";

const MIN_POSITION = 0;
const MAX_POSITION = 1;

export class KeyboardInput implements InputSource {
    private readonly pressedKeys = new Set<string>();

    private leftX = 0.375;
    private rightX = 0.625;

    /**
     * Movement speed measured in normalized playfield units per second.
     *
     * At 0.65, moving from one edge to the other takes approximately
     * 1.54 seconds.
     */
    private readonly movementSpeed = 0.65;

    constructor() {
        window.addEventListener("keydown", this.handleKeyDown);
        window.addEventListener("keyup", this.handleKeyUp);
        window.addEventListener("blur", this.handleWindowBlur);
    }

    public update(deltaSeconds: number): void {
        const movementAmount = this.movementSpeed * deltaSeconds;

        if (this.pressedKeys.has("KeyA")) {
            this.leftX -= movementAmount;
        }

        if (this.pressedKeys.has("KeyD")) {
            this.leftX += movementAmount;
        }

        if (this.pressedKeys.has("ArrowLeft")) {
            this.rightX -= movementAmount;
        }

        if (this.pressedKeys.has("ArrowRight")) {
            this.rightX += movementAmount;
        }

        this.leftX = this.clamp(
            this.leftX,
            MIN_POSITION,
            MAX_POSITION,
        );

        this.rightX = this.clamp(
            this.rightX,
            MIN_POSITION,
            MAX_POSITION,
        );
    }

    public getFootState(): FootState {
        return {
            leftX: this.leftX,
            rightX: this.rightX,
            leftVisible: true,
            rightVisible: true,
            timestampMs: performance.now(),
        };
    }

    public destroy(): void {
        window.removeEventListener("keydown", this.handleKeyDown);
        window.removeEventListener("keyup", this.handleKeyUp);
        window.removeEventListener("blur", this.handleWindowBlur);

        this.pressedKeys.clear();
    }

    private readonly handleKeyDown = (event: KeyboardEvent): void => {
        if (!this.isMovementKey(event.code)) {
            return;
        }

        event.preventDefault();
        this.pressedKeys.add(event.code);
    };

    private readonly handleKeyUp = (event: KeyboardEvent): void => {
        if (!this.isMovementKey(event.code)) {
            return;
        }

        event.preventDefault();
        this.pressedKeys.delete(event.code);
    };

    private readonly handleWindowBlur = (): void => {
        /*
         * If the browser loses focus while a key is held, it might never
         * receive the corresponding keyup event. Clearing the set prevents
         * a foot from becoming stuck in motion.
         */
        this.pressedKeys.clear();
    };

    private isMovementKey(code: string): boolean {
        return (
            code === "KeyA" ||
            code === "KeyD" ||
            code === "ArrowLeft" ||
            code === "ArrowRight"
        );
    }

    private clamp(value: number, minimum: number, maximum: number): number {
        return Math.min(Math.max(value, minimum), maximum);
    }
}