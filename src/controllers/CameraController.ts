import { CameraFootInput } from "../camera/CameraFootInput";
import { CameraManager } from "../camera/CameraManager";
import {
  InputManager,
  type InputMode,
} from "../input/InputManager";

export class CameraController {
  private readonly input: InputManager;
  private readonly cameraManager: CameraManager;
  private readonly cameraInput: CameraFootInput;

  private readonly inputModeSelect: HTMLSelectElement;
  private readonly cameraDeviceSelect: HTMLSelectElement;
  private readonly cameraMirrorToggle: HTMLInputElement;
  private readonly cameraEnableButton: HTMLButtonElement;
  private readonly cameraDisableButton: HTMLButtonElement;
  private readonly cameraStatus: HTMLElement;
  private readonly visibilityThresholdInput: HTMLInputElement;
  private readonly visibilityThresholdValue: HTMLOutputElement;
  private readonly inferenceFpsInput: HTMLInputElement;
  private readonly inferenceFpsValue: HTMLOutputElement;

  private unsubscribeFromCameraStatus: (() => void) | null = null;
  private unsubscribeFromPoseTrackerStatus: (() => void) | null = null;
  private initialized = false;
  private destroyed = false;

  public constructor(
    input: InputManager,
    cameraManager: CameraManager,
    cameraInput: CameraFootInput,
  ) {
    this.input = input;
    this.cameraManager = cameraManager;
    this.cameraInput = cameraInput;

    this.inputModeSelect = this.requireElement<HTMLSelectElement>(
      "#input-mode-select",
    );
    this.cameraDeviceSelect = this.requireElement<HTMLSelectElement>(
      "#camera-device-select",
    );
    this.cameraMirrorToggle = this.requireElement<HTMLInputElement>(
      "#camera-mirror-toggle",
    );
    this.cameraEnableButton = this.requireElement<HTMLButtonElement>(
      "#camera-enable-button",
    );
    this.cameraDisableButton = this.requireElement<HTMLButtonElement>(
      "#camera-disable-button",
    );
    this.cameraStatus = this.requireElement<HTMLElement>(
      "#camera-status",
    );
    this.visibilityThresholdInput = this.requireElement<HTMLInputElement>(
      "#camera-visibility-threshold",
    );
    this.visibilityThresholdValue = this.requireElement<HTMLOutputElement>(
      "#camera-visibility-threshold-value",
    );
    this.inferenceFpsInput = this.requireElement<HTMLInputElement>(
      "#camera-inference-fps",
    );
    this.inferenceFpsValue = this.requireElement<HTMLOutputElement>(
      "#camera-inference-fps-value",
    );
  }

  public initialize(): void {
    if (this.initialized || this.destroyed) {
      return;
    }

    this.initialized = true;

    this.applyInitialSettings();
    this.setInputMode("keyboard");

    this.inputModeSelect.addEventListener(
      "change",
      this.handleInputModeChange,
    );
    this.cameraEnableButton.addEventListener(
      "click",
      this.handleCameraEnableClick,
    );
    this.cameraDisableButton.addEventListener(
      "click",
      this.handleCameraDisableClick,
    );
    this.cameraDeviceSelect.addEventListener(
      "change",
      this.handleCameraDeviceChange,
    );
    this.cameraMirrorToggle.addEventListener(
      "change",
      this.handleMirrorChange,
    );
    this.visibilityThresholdInput.addEventListener(
      "input",
      this.handleVisibilityThresholdInput,
    );
    this.inferenceFpsInput.addEventListener(
      "input",
      this.handleInferenceFpsInput,
    );

    this.unsubscribeFromCameraStatus =
      this.cameraManager.subscribe(
        (status, message) => {
          this.setCameraStatus(
            message,
            status === "error",
          );

          const running = status === "running";
          this.cameraDisableButton.disabled = !running;

          if (status === "error") {
            this.setInputMode("keyboard");
          }
        },
      );

    this.unsubscribeFromPoseTrackerStatus =
      this.cameraInput.subscribeToTrackerStatus(
        (status, message) => {
          this.setCameraStatus(
            message,
            status === "error",
          );

          if (status === "error") {
            this.setInputMode("keyboard");
          }
        },
      );
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    this.inputModeSelect.removeEventListener(
      "change",
      this.handleInputModeChange,
    );
    this.cameraEnableButton.removeEventListener(
      "click",
      this.handleCameraEnableClick,
    );
    this.cameraDisableButton.removeEventListener(
      "click",
      this.handleCameraDisableClick,
    );
    this.cameraDeviceSelect.removeEventListener(
      "change",
      this.handleCameraDeviceChange,
    );
    this.cameraMirrorToggle.removeEventListener(
      "change",
      this.handleMirrorChange,
    );
    this.visibilityThresholdInput.removeEventListener(
      "input",
      this.handleVisibilityThresholdInput,
    );
    this.inferenceFpsInput.removeEventListener(
      "input",
      this.handleInferenceFpsInput,
    );

    this.unsubscribeFromCameraStatus?.();
    this.unsubscribeFromCameraStatus = null;

    this.unsubscribeFromPoseTrackerStatus?.();
    this.unsubscribeFromPoseTrackerStatus = null;
  }

  private readonly handleInputModeChange = (): void => {
    const requestedMode = this.inputModeSelect.value as InputMode;

    if (
      requestedMode === "camera" &&
      !this.cameraManager.isRunning()
    ) {
      this.setInputMode("keyboard");
      this.setCameraStatus(
        "Enable the camera before selecting camera input.",
        true,
      );
      return;
    }

    this.setInputMode(requestedMode);
  };

  private readonly handleCameraEnableClick = (): void => {
    void this.startSelectedCamera();
  };

  private readonly handleCameraDisableClick = (): void => {
    this.stopCamera();
  };

  private readonly handleCameraDeviceChange = (): void => {
    if (this.cameraManager.isRunning()) {
      void this.startSelectedCamera();
    }
  };

  private readonly handleMirrorChange = (): void => {
    const mirrored = this.cameraMirrorToggle.checked;

    this.cameraManager.setMirrored(mirrored);
    this.cameraInput.setMirrored(mirrored);
  };

  private readonly handleVisibilityThresholdInput = (): void => {
    const threshold = Number.parseFloat(
      this.visibilityThresholdInput.value,
    );

    this.cameraInput.setVisibilityThreshold(threshold);
    this.visibilityThresholdValue.value = threshold.toFixed(2);
  };

  private readonly handleInferenceFpsInput = (): void => {
    const framesPerSecond = Number.parseInt(
      this.inferenceFpsInput.value,
      10,
    );

    this.cameraInput.setInferenceFramesPerSecond(framesPerSecond);
    this.inferenceFpsValue.value = framesPerSecond.toString();
  };

  private applyInitialSettings(): void {
    const initialMirror = this.cameraMirrorToggle.checked;
    const initialVisibilityThreshold = Number.parseFloat(
      this.visibilityThresholdInput.value,
    );
    const initialInferenceFramesPerSecond = Number.parseInt(
      this.inferenceFpsInput.value,
      10,
    );

    this.cameraManager.setMirrored(initialMirror);
    this.cameraInput.setMirrored(initialMirror);
    this.cameraInput.setVisibilityThreshold(
      initialVisibilityThreshold,
    );
    this.cameraInput.setInferenceFramesPerSecond(
      initialInferenceFramesPerSecond,
    );

    this.visibilityThresholdValue.value =
      initialVisibilityThreshold.toFixed(2);
    this.inferenceFpsValue.value =
      initialInferenceFramesPerSecond.toString();
  }

  private setInputMode(mode: InputMode): void {
    this.input.setMode(mode);
    this.inputModeSelect.value = mode;

    if (mode === "camera") {
      this.setCameraStatus(
        this.cameraManager.isRunning()
          ? "Camera pose tracking is active."
          : "Camera input selected, but the camera is not running.",
      );
      return;
    }

    this.setCameraStatus(
      this.cameraManager.isRunning()
        ? "Keyboard input selected. Camera preview remains active."
        : "Keyboard input is active.",
    );
  }

  private async refreshCameraList(): Promise<void> {
    const previousSelection =
      this.cameraManager.getSelectedDeviceId() ??
      this.cameraDeviceSelect.value;

    const cameras = await this.cameraManager.listCameras();
    this.cameraDeviceSelect.replaceChildren();

    if (cameras.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No cameras found";
      this.cameraDeviceSelect.append(option);
      this.cameraDeviceSelect.disabled = true;
      return;
    }

    cameras.forEach((camera, index) => {
      const option = document.createElement("option");
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      this.cameraDeviceSelect.append(option);
    });

    const matchingCamera = cameras.find(
      (camera) => camera.deviceId === previousSelection,
    );

    this.cameraDeviceSelect.value =
      matchingCamera?.deviceId ??
      cameras[0]?.deviceId ??
      "";
    this.cameraDeviceSelect.disabled = false;
  }

  private async startSelectedCamera(): Promise<void> {
    this.cameraEnableButton.disabled = true;
    this.cameraDeviceSelect.disabled = true;

    try {
      const selectedDeviceId =
        this.cameraDeviceSelect.value || undefined;

      await this.cameraManager.start(selectedDeviceId);
      await this.cameraInput.initialize();
      await this.refreshCameraList();

      const activeDeviceId =
        this.cameraManager.getSelectedDeviceId();

      if (activeDeviceId) {
        this.cameraDeviceSelect.value = activeDeviceId;
      }

      this.cameraDisableButton.disabled = false;
      this.setInputMode("camera");
    } catch (error) {
      console.error(error);
      this.setInputMode("keyboard");
    } finally {
      this.cameraEnableButton.disabled = false;
      this.cameraDeviceSelect.disabled =
        !this.cameraManager.isRunning();
    }
  }

  private stopCamera(): void {
    this.cameraManager.stop();
    this.cameraDisableButton.disabled = true;
    this.cameraDeviceSelect.disabled = true;

    if (this.input.getMode() === "camera") {
      this.setInputMode("keyboard");
    }
  }

  private setCameraStatus(
    message: string,
    isError = false,
  ): void {
    this.cameraStatus.textContent = message;
    this.cameraStatus.classList.toggle(
      "camera-status--error",
      isError,
    );
  }

  private requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);

    if (!element) {
      throw new Error(
        `Required camera element was not found: ${selector}`,
      );
    }

    return element;
  }
}
