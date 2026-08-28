import { CameraFootInput } from "../camera/CameraFootInput";
import { CameraManager } from "../camera/CameraManager";
import { InputManager, type InputMode } from "../input/InputManager";
import type { SettingsStore } from "../settings/SettingsStore";

export class CameraController {
  private readonly input: InputManager;
  private readonly cameraManager: CameraManager;
  private readonly cameraInput: CameraFootInput;
  private readonly settingsStore: SettingsStore;

  private readonly inputModeSelect = this.requireElement<HTMLSelectElement>("#input-mode-select");
  private readonly cameraDeviceSelect = this.requireElement<HTMLSelectElement>("#camera-device-select");
  private readonly cameraMirrorToggle = this.requireElement<HTMLInputElement>("#camera-mirror-toggle");
  private readonly cameraEnableButton = this.requireElement<HTMLButtonElement>("#camera-enable-button");
  private readonly cameraDisableButton = this.requireElement<HTMLButtonElement>("#camera-disable-button");
  private readonly cameraStatus = this.requireElement<HTMLElement>("#camera-status");
  private readonly visibilityThresholdInput = this.requireElement<HTMLInputElement>("#camera-visibility-threshold");
  private readonly visibilityThresholdValue = this.requireElement<HTMLOutputElement>("#camera-visibility-threshold-value");
  private readonly footConfidenceInput = this.requireElement<HTMLInputElement>("#camera-foot-confidence");
  private readonly footConfidenceValue = this.requireElement<HTMLOutputElement>("#camera-foot-confidence-value");
  private readonly inferenceFpsInput = this.requireElement<HTMLInputElement>("#camera-inference-fps");
  private readonly inferenceFpsValue = this.requireElement<HTMLOutputElement>("#camera-inference-fps-value");

  private unsubscribeFromCameraStatus: (() => void) | null = null;
  private unsubscribeFromPoseTrackerStatus: (() => void) | null = null;
  private unsubscribeSettings: (() => void) | null = null;
  private initialized = false;
  private destroyed = false;

  public constructor(
    input: InputManager,
    cameraManager: CameraManager,
    cameraInput: CameraFootInput,
    settingsStore: SettingsStore,
  ) {
    this.input = input;
    this.cameraManager = cameraManager;
    this.cameraInput = cameraInput;
    this.settingsStore = settingsStore;
  }

  public initialize(): void {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;

    this.inputModeSelect.addEventListener("change", this.handleInputModeChange);
    this.cameraEnableButton.addEventListener("click", this.handleCameraEnableClick);
    this.cameraDisableButton.addEventListener("click", this.handleCameraDisableClick);
    this.cameraDeviceSelect.addEventListener("change", this.handleCameraDeviceChange);
    this.cameraMirrorToggle.addEventListener("change", this.handleMirrorChange);
    this.visibilityThresholdInput.addEventListener("input", this.handleVisibilityThresholdInput);
    this.footConfidenceInput.addEventListener("input", this.handleFootConfidenceInput);
    this.inferenceFpsInput.addEventListener("input", this.handleInferenceFpsInput);

    this.unsubscribeSettings = this.settingsStore.subscribe((settings) => {
      this.cameraManager.setMirrored(settings.input.mirrorCamera);
      this.cameraInput.setMirrored(settings.input.mirrorCamera);
      this.cameraInput.setVisibilityThreshold(settings.input.visibilityThreshold);
      this.cameraInput.setMinimumFootConfidence(settings.input.minimumFootConfidence);
      this.cameraInput.setInferenceFramesPerSecond(settings.input.inferenceFps);

      this.inputModeSelect.value = settings.input.mode;
      this.cameraMirrorToggle.checked = settings.input.mirrorCamera;
      this.visibilityThresholdInput.value = settings.input.visibilityThreshold.toString();
      this.visibilityThresholdValue.value = settings.input.visibilityThreshold.toFixed(2);
      this.footConfidenceInput.value = settings.input.minimumFootConfidence.toString();
      this.footConfidenceValue.value = settings.input.minimumFootConfidence.toFixed(2);
      this.inferenceFpsInput.value = settings.input.inferenceFps.toString();
      this.inferenceFpsValue.value = settings.input.inferenceFps.toString();
    });

    this.setInputMode("keyboard");

    this.unsubscribeFromCameraStatus = this.cameraManager.subscribe((status, message) => {
      this.setCameraStatus(message, status === "error");
      const running = status === "running";
      this.cameraDisableButton.disabled = !running;
      if (status === "error") this.setInputMode("keyboard");
    });

    this.unsubscribeFromPoseTrackerStatus = this.cameraInput.subscribeToTrackerStatus((status, message) => {
      this.setCameraStatus(message, status === "error");
      if (status === "error") this.setInputMode("keyboard");
    });
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.inputModeSelect.removeEventListener("change", this.handleInputModeChange);
    this.cameraEnableButton.removeEventListener("click", this.handleCameraEnableClick);
    this.cameraDisableButton.removeEventListener("click", this.handleCameraDisableClick);
    this.cameraDeviceSelect.removeEventListener("change", this.handleCameraDeviceChange);
    this.cameraMirrorToggle.removeEventListener("change", this.handleMirrorChange);
    this.visibilityThresholdInput.removeEventListener("input", this.handleVisibilityThresholdInput);
    this.footConfidenceInput.removeEventListener("input", this.handleFootConfidenceInput);
    this.inferenceFpsInput.removeEventListener("input", this.handleInferenceFpsInput);
    this.unsubscribeFromCameraStatus?.();
    this.unsubscribeFromPoseTrackerStatus?.();
    this.unsubscribeSettings?.();
  }

  public stopCamera(): void {
    this.cameraManager.stop();
    this.cameraDisableButton.disabled = true;
    this.cameraDeviceSelect.disabled = true;
    if (this.input.getMode() === "camera") this.setInputMode("keyboard");
  }

  /**
   * Apply the player's persisted input preference when gameplay is about to
   * begin. Camera is a preference in Settings, but the MediaStream remains
   * stopped while it is not needed. This method bridges those two concerns:
   * keyboard becomes active immediately, while camera mode starts the selected
   * device and pose tracker before the game begins.
   */
  public async prepareForGameplay(): Promise<void> {
    const settings = this.settingsStore.get();

    if (settings.input.mode === "keyboard") {
      if (this.cameraManager.isRunning()) {
        this.cameraManager.stop();
      }
      this.setInputMode("keyboard");
      return;
    }

    if (this.cameraManager.isRunning()) {
      await this.cameraInput.initialize();
      this.setInputMode("camera");
      return;
    }

    await this.startSelectedCamera();
  }

  private readonly handleInputModeChange = (): void => {
    const requestedMode = this.inputModeSelect.value as InputMode;
    this.patchInput("mode", requestedMode);
    if (requestedMode === "camera" && !this.cameraManager.isRunning()) {
      this.setInputMode("keyboard");
      this.setCameraStatus("Enable the camera before selecting camera input.", true);
      return;
    }
    if (requestedMode === "keyboard") {
      this.stopCamera();
      return;
    }
    this.setInputMode(requestedMode);
  };

  private readonly handleCameraEnableClick = (): void => { void this.startSelectedCamera(); };
  private readonly handleCameraDisableClick = (): void => {
    this.patchInput("mode", "keyboard");
    this.stopCamera();
  };
  private readonly handleCameraDeviceChange = (): void => {
    this.patchInput("cameraDeviceId", this.cameraDeviceSelect.value);
    if (this.cameraManager.isRunning()) void this.startSelectedCamera();
  };
  private readonly handleMirrorChange = (): void => this.patchInput("mirrorCamera", this.cameraMirrorToggle.checked);
  private readonly handleVisibilityThresholdInput = (): void => this.patchInput("visibilityThreshold", Number.parseFloat(this.visibilityThresholdInput.value));
  private readonly handleFootConfidenceInput = (): void => this.patchInput("minimumFootConfidence", Number.parseFloat(this.footConfidenceInput.value));
  private readonly handleInferenceFpsInput = (): void => this.patchInput("inferenceFps", Number.parseInt(this.inferenceFpsInput.value, 10));

  private setInputMode(mode: InputMode): void {
    this.input.setMode(mode);
    this.inputModeSelect.value = mode;
    if (mode === "camera") {
      this.setCameraStatus(this.cameraManager.isRunning() ? "Camera pose tracking is active." : "Camera input selected, but the camera is not running.");
    } else {
      this.setCameraStatus("Keyboard input is active.");
    }
  }

  private async refreshCameraList(): Promise<void> {
    const settings = this.settingsStore.get();
    const previousSelection = this.cameraManager.getSelectedDeviceId() ?? settings.input.cameraDeviceId ?? this.cameraDeviceSelect.value;
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
    const matchingCamera = cameras.find((camera) => camera.deviceId === previousSelection);
    this.cameraDeviceSelect.value = matchingCamera?.deviceId ?? cameras[0]?.deviceId ?? "";
    this.cameraDeviceSelect.disabled = false;
  }

  private async startSelectedCamera(): Promise<void> {
    this.cameraEnableButton.disabled = true;
    this.cameraDeviceSelect.disabled = true;
    try {
      const selectedDeviceId = this.settingsStore.get().input.cameraDeviceId || this.cameraDeviceSelect.value || undefined;
      await this.cameraManager.start(selectedDeviceId);
      await this.cameraInput.initialize();
      await this.refreshCameraList();
      const activeDeviceId = this.cameraManager.getSelectedDeviceId();
      if (activeDeviceId) {
        this.cameraDeviceSelect.value = activeDeviceId;
        this.patchInput("cameraDeviceId", activeDeviceId);
      }
      this.cameraDisableButton.disabled = false;
      this.patchInput("mode", "camera");
      this.setInputMode("camera");
    } catch (error) {
      console.error(error);
      this.setInputMode("keyboard");
    } finally {
      this.cameraEnableButton.disabled = false;
      this.cameraDeviceSelect.disabled = !this.cameraManager.isRunning();
    }
  }

  private patchInput<K extends keyof ReturnType<SettingsStore["get"]>["input"]>(
    key: K,
    value: ReturnType<SettingsStore["get"]>["input"][K],
  ): void {
    this.settingsStore.update((settings) => ({
      ...settings,
      input: { ...settings.input, [key]: value },
    }));
  }

  private setCameraStatus(message: string, isError = false): void {
    this.cameraStatus.textContent = message;
    this.cameraStatus.classList.toggle("camera-status--error", isError);
  }

  private requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Required camera element was not found: ${selector}`);
    return element;
  }
}
