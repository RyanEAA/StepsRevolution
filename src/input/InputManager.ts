import type { FootState } from "../types/FootState";
import type { InputSource } from "./InputSource";

export type InputMode = "keyboard" | "camera";

export class InputManager implements InputSource {
    private readonly keyboardInput: InputSource;
    private readonly cameraInput: InputSource;

    private activeMode: InputMode = "keyboard";

    constructor(
        keyboardInput: InputSource,
        cameraInput: InputSource,
    ) {
        this.keyboardInput = keyboardInput;
        this.cameraInput = cameraInput;
    }

    public setMode(mode: InputMode): void {
        this.activeMode = mode;
    }

    public getMode(): InputMode {
        return this.activeMode;
    }

    public update(deltaSeconds: number): void {
        this.getActiveSource().update(deltaSeconds);
    }

    public getFootState(): FootState {
        return this.getActiveSource().getFootState();
    }

    public destroy(): void {
        this.keyboardInput.destroy();
        this.cameraInput.destroy();
    }

    private getActiveSource(): InputSource {
        return this.activeMode === "camera"
            ? this.cameraInput
            : this.keyboardInput;
    }
}
