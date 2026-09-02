import type { CameraManager } from "../camera/CameraManager";
import type { SettingsStore } from "./SettingsStore";

export interface SettingsControllerOptions {
  store: SettingsStore;
  cameraManager: CameraManager;
  onBack: () => void;
  onOpenCalibration: () => void;
}

export class SettingsController {
  private readonly store: SettingsStore;
  private readonly cameraManager: CameraManager;
  private readonly onBack: () => void;
  private readonly onOpenCalibration: () => void;
  private unsubscribeSettings: (() => void) | null = null;

  private readonly backButton = this.require<HTMLButtonElement>("#settings-back-button");
  private readonly resetButton = this.require<HTMLButtonElement>("#settings-reset-button");
  private readonly calibrationButton = this.require<HTMLButtonElement>("#open-calibration-button");
  private readonly inputMode = this.require<HTMLSelectElement>("#settings-input-mode");
  private readonly cameraDevice = this.require<HTMLSelectElement>("#settings-camera-device");
  private readonly mirrorCamera = this.require<HTMLInputElement>("#settings-mirror-camera");
  private readonly visibility = this.require<HTMLInputElement>("#settings-visibility-threshold");
  private readonly visibilityValue = this.require<HTMLOutputElement>("#settings-visibility-threshold-value");
  private readonly footConfidence = this.require<HTMLInputElement>("#settings-foot-confidence");
  private readonly footConfidenceValue = this.require<HTMLOutputElement>("#settings-foot-confidence-value");
  private readonly inferenceFps = this.require<HTMLInputElement>("#settings-inference-fps");
  private readonly inferenceFpsValue = this.require<HTMLOutputElement>("#settings-inference-fps-value");
  private readonly playfieldWidth = this.require<HTMLInputElement>("#settings-playfield-width");
  private readonly playfieldWidthValue = this.require<HTMLOutputElement>("#settings-playfield-width-value");
  private readonly showDiagnostics = this.require<HTMLInputElement>("#settings-show-diagnostics");
  private readonly reducedMotion = this.require<HTMLInputElement>("#settings-reduced-motion");
  private readonly tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-settings-section]"));
  private readonly panels = Array.from(document.querySelectorAll<HTMLElement>("[data-settings-panel]"));

  public constructor(options: SettingsControllerOptions) {
    this.store = options.store;
    this.cameraManager = options.cameraManager;
    this.onBack = options.onBack;
    this.onOpenCalibration = options.onOpenCalibration;
  }

  public initialize(): void {
    this.backButton.addEventListener("click", this.onBack);
    this.resetButton.addEventListener("click", this.handleReset);
    this.calibrationButton.addEventListener("click", this.onOpenCalibration);
    this.inputMode.addEventListener("change", this.handleInputMode);
    this.cameraDevice.addEventListener("change", this.handleCameraDevice);
    this.mirrorCamera.addEventListener("change", this.handleMirror);
    this.visibility.addEventListener("input", this.handleVisibility);
    this.footConfidence.addEventListener("input", this.handleFootConfidence);
    this.inferenceFps.addEventListener("input", this.handleInferenceFps);
    this.playfieldWidth.addEventListener("input", this.handlePlayfieldWidth);
    this.showDiagnostics.addEventListener("change", this.handleDiagnostics);
    this.reducedMotion.addEventListener("change", this.handleReducedMotion);
    this.tabs.forEach((tab) => tab.addEventListener("click", this.handleTabClick));

    this.unsubscribeSettings = this.store.subscribe((settings) => {
      this.inputMode.value = settings.input.mode;
      this.mirrorCamera.checked = settings.input.mirrorCamera;
      this.visibility.value = settings.input.visibilityThreshold.toString();
      this.visibilityValue.value = settings.input.visibilityThreshold.toFixed(2);
      this.footConfidence.value = settings.input.minimumFootConfidence.toString();
      this.footConfidenceValue.value = settings.input.minimumFootConfidence.toFixed(2);
      this.inferenceFps.value = settings.input.inferenceFps.toString();
      this.inferenceFpsValue.value = settings.input.inferenceFps.toString();
      this.playfieldWidth.value = settings.gameplay.playfieldWidth.toString();
      this.playfieldWidthValue.value = `${settings.gameplay.playfieldWidth} px`;
      this.showDiagnostics.checked = settings.interface.showDiagnostics;
      this.reducedMotion.checked = settings.interface.reducedMotion;
      if (this.cameraDevice.options.length > 0) {
        this.cameraDevice.value = Array.from(this.cameraDevice.options).some((option) => option.value === settings.input.cameraDeviceId)
          ? settings.input.cameraDeviceId
          : "";
      }
    });

    void this.refreshCameraList();
  }

  public destroy(): void {
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.backButton.removeEventListener("click", this.onBack);
    this.resetButton.removeEventListener("click", this.handleReset);
    this.calibrationButton.removeEventListener("click", this.onOpenCalibration);
    this.inputMode.removeEventListener("change", this.handleInputMode);
    this.cameraDevice.removeEventListener("change", this.handleCameraDevice);
    this.mirrorCamera.removeEventListener("change", this.handleMirror);
    this.visibility.removeEventListener("input", this.handleVisibility);
    this.footConfidence.removeEventListener("input", this.handleFootConfidence);
    this.inferenceFps.removeEventListener("input", this.handleInferenceFps);
    this.playfieldWidth.removeEventListener("input", this.handlePlayfieldWidth);
    this.showDiagnostics.removeEventListener("change", this.handleDiagnostics);
    this.reducedMotion.removeEventListener("change", this.handleReducedMotion);
    this.tabs.forEach((tab) => tab.removeEventListener("click", this.handleTabClick));
  }

  public async refreshCameraList(preferred = this.store.get().input.cameraDeviceId): Promise<void> {
    try {
      const cameras = await this.cameraManager.listCameras();
      this.cameraDevice.replaceChildren();
      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = "Default camera";
      this.cameraDevice.append(defaultOption);
      cameras.forEach((camera, index) => {
        const option = document.createElement("option");
        option.value = camera.deviceId;
        option.textContent = camera.label || `Camera ${index + 1}`;
        this.cameraDevice.append(option);
      });
      this.cameraDevice.value = cameras.some((camera) => camera.deviceId === preferred)
        ? preferred
        : "";
    } catch {
      this.cameraDevice.replaceChildren();
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Camera unavailable";
      this.cameraDevice.append(option);
    }
  }

  private readonly handleReset = (): void => {
    if (window.confirm("Reset all Visince settings to their defaults?")) {
      this.store.reset();
    }
  };

  private readonly handleInputMode = (): void => this.patchInput("mode", this.inputMode.value as "keyboard" | "camera");
  private readonly handleCameraDevice = (): void => this.patchInput("cameraDeviceId", this.cameraDevice.value);
  private readonly handleMirror = (): void => this.patchInput("mirrorCamera", this.mirrorCamera.checked);
  private readonly handleVisibility = (): void => this.patchInput("visibilityThreshold", Number.parseFloat(this.visibility.value));
  private readonly handleFootConfidence = (): void => this.patchInput("minimumFootConfidence", Number.parseFloat(this.footConfidence.value));
  private readonly handleInferenceFps = (): void => this.patchInput("inferenceFps", Number.parseInt(this.inferenceFps.value, 10));

  private readonly handlePlayfieldWidth = (): void => {
    const width = Number.parseInt(this.playfieldWidth.value, 10);
    this.store.update((settings) => ({
      ...settings,
      gameplay: { ...settings.gameplay, playfieldWidth: width },
    }));
  };

  private readonly handleDiagnostics = (): void => {
    this.store.update((settings) => ({
      ...settings,
      interface: { ...settings.interface, showDiagnostics: this.showDiagnostics.checked },
    }));
  };

  private readonly handleReducedMotion = (): void => {
    this.store.update((settings) => ({
      ...settings,
      interface: { ...settings.interface, reducedMotion: this.reducedMotion.checked },
    }));
  };

  private readonly handleTabClick = (event: Event): void => {
    const target = event.currentTarget as HTMLButtonElement;
    const section = target.dataset.settingsSection;
    this.tabs.forEach((tab) => tab.classList.toggle("settings-tab--active", tab === target));
    this.panels.forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== section; });
  };

  private patchInput<K extends keyof ReturnType<SettingsStore["get"]>["input"]>(
    key: K,
    value: ReturnType<SettingsStore["get"]>["input"][K],
  ): void {
    this.store.update((settings) => ({
      ...settings,
      input: { ...settings.input, [key]: value },
    }));
  }

  private require<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Required settings element not found: ${selector}`);
    return element;
  }
}
