import type { InputSource } from "../input/InputSource";
import type { FootState } from "../types/FootState";
import { CameraManager } from "./CameraManager";

export class CameraFootInput implements InputSource {
    private readonly cameraManager: CameraManager;

    private footState: FootState = {
        leftX: 0.375,
        rightX: 0.625,
        leftVisible: false,
        rightVisible: false,
        timestampMs: performance.now(),
    };

    constructor(cameraManager: CameraManager) {
        this.cameraManager = cameraManager;
    }

    public update(_deltaSeconds: number): void {
        this.footState = {
            ...this.footState,
            leftVisible: false,
            rightVisible: false,
            timestampMs: performance.now(),
        };
    }

    public getFootState(): FootState {
        return this.footState;
    }

    public destroy(): void {
        this.cameraManager.destroy();
    }
}
