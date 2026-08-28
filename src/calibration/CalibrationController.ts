import type { CameraFootInput } from "../camera/CameraFootInput";
import type { CameraManager } from "../camera/CameraManager";
import type { SettingsStore } from "../settings/SettingsStore";

const SAMPLE_DURATION_MS = 3000;
const SAMPLE_INTERVAL_MS = 100;

export interface CalibrationControllerOptions {
  cameraManager: CameraManager;
  cameraInput: CameraFootInput;
  settingsStore: SettingsStore;
  onBack: () => void;
}

export class CalibrationController {
  private readonly cameraManager: CameraManager;
  private readonly cameraInput: CameraFootInput;
  private readonly settingsStore: SettingsStore;
  private readonly onBack: () => void;
  private readonly previewShell: HTMLElement;
  private readonly originalPreviewParent: Node;
  private readonly originalPreviewNextSibling: Node | null;
  private updateHandle: number | null = null;
  private sampleTimer: number | null = null;
  private recommendedConfidence: number | null = null;
  private unsubscribeSettings: (() => void) | null = null;

  private readonly backButton = this.require<HTMLButtonElement>("#calibration-back-button");
  private readonly previewHost = this.require<HTMLElement>("#calibration-preview-host");
  private readonly enableButton = this.require<HTMLButtonElement>("#calibration-enable-camera");
  private readonly disableButton = this.require<HTMLButtonElement>("#calibration-disable-camera");
  private readonly status = this.require<HTMLElement>("#calibration-status");
  private readonly leftCard = this.require<HTMLElement>("#calibration-left-foot-card");
  private readonly rightCard = this.require<HTMLElement>("#calibration-right-foot-card");
  private readonly leftState = this.require<HTMLElement>("#calibration-left-state");
  private readonly rightState = this.require<HTMLElement>("#calibration-right-state");
  private readonly leftMeter = this.require<HTMLElement>("#calibration-left-meter");
  private readonly rightMeter = this.require<HTMLElement>("#calibration-right-meter");
  private readonly leftConfidence = this.require<HTMLOutputElement>("#calibration-left-confidence");
  private readonly rightConfidence = this.require<HTMLOutputElement>("#calibration-right-confidence");
  private readonly visibility = this.require<HTMLInputElement>("#calibration-visibility-threshold");
  private readonly visibilityValue = this.require<HTMLOutputElement>("#calibration-visibility-value");
  private readonly confidenceThreshold = this.require<HTMLInputElement>("#calibration-foot-confidence-threshold");
  private readonly confidenceThresholdValue = this.require<HTMLOutputElement>("#calibration-foot-confidence-value");
  private readonly sampleButton = this.require<HTMLButtonElement>("#calibration-sample-button");
  private readonly useRecommendedButton = this.require<HTMLButtonElement>("#calibration-use-recommended");
  private readonly recommendedValue = this.require<HTMLElement>("#calibration-recommended-value");
  private readonly recommendationCopy = this.require<HTMLElement>("#calibration-recommendation-copy");

  public constructor(options: CalibrationControllerOptions) {
    this.cameraManager = options.cameraManager;
    this.cameraInput = options.cameraInput;
    this.settingsStore = options.settingsStore;
    this.onBack = options.onBack;

    const previewShell = this.cameraManager.getVideoElement().closest<HTMLElement>(".camera-preview-shell");
    if (!previewShell || !previewShell.parentNode) {
      throw new Error("Camera preview shell is unavailable for calibration.");
    }
    this.previewShell = previewShell;
    this.originalPreviewParent = previewShell.parentNode;
    this.originalPreviewNextSibling = previewShell.nextSibling;
  }

  public initialize(): void {
    this.backButton.addEventListener("click", this.handleBack);
    this.enableButton.addEventListener("click", this.handleEnable);
    this.disableButton.addEventListener("click", this.handleDisable);
    this.visibility.addEventListener("input", this.handleVisibility);
    this.confidenceThreshold.addEventListener("input", this.handleConfidenceThreshold);
    this.sampleButton.addEventListener("click", this.handleSample);
    this.useRecommendedButton.addEventListener("click", this.handleUseRecommended);

    this.unsubscribeSettings = this.settingsStore.subscribe((settings) => {
      this.visibility.value = settings.input.visibilityThreshold.toString();
      this.visibilityValue.value = settings.input.visibilityThreshold.toFixed(2);
      this.confidenceThreshold.value = settings.input.minimumFootConfidence.toString();
      this.confidenceThresholdValue.value = settings.input.minimumFootConfidence.toFixed(2);
    });
  }

  public enter(): void {
    this.previewHost.prepend(this.previewShell);
    this.previewShell.classList.add("camera-preview-shell--calibration");
    this.startReadoutLoop();
  }

  public leave(): void {
    this.cancelSample();
    this.stopReadoutLoop();
    this.cameraInput.setActive(false);
    this.cameraManager.stop();
    this.previewShell.classList.remove("camera-preview-shell--calibration");
    if (this.originalPreviewNextSibling) {
      this.originalPreviewParent.insertBefore(this.previewShell, this.originalPreviewNextSibling);
    } else {
      this.originalPreviewParent.appendChild(this.previewShell);
    }
    this.setStatus("Camera is off.");
    this.updateCameraButtons(false);
  }

  public destroy(): void {
    this.leave();
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.backButton.removeEventListener("click", this.handleBack);
    this.enableButton.removeEventListener("click", this.handleEnable);
    this.disableButton.removeEventListener("click", this.handleDisable);
    this.visibility.removeEventListener("input", this.handleVisibility);
    this.confidenceThreshold.removeEventListener("input", this.handleConfidenceThreshold);
    this.sampleButton.removeEventListener("click", this.handleSample);
    this.useRecommendedButton.removeEventListener("click", this.handleUseRecommended);
  }

  private readonly handleBack = (): void => {
    this.leave();
    this.onBack();
  };

  private readonly handleEnable = (): void => {
    void this.enableCamera();
  };

  private readonly handleDisable = (): void => {
    this.cameraInput.setActive(false);
    this.cameraManager.stop();
    this.updateCameraButtons(false);
    this.setStatus("Camera is off.");
  };

  private readonly handleVisibility = (): void => {
    const value = Number.parseFloat(this.visibility.value);
    this.settingsStore.update((settings) => ({
      ...settings,
      input: { ...settings.input, visibilityThreshold: value },
    }));
  };

  private readonly handleConfidenceThreshold = (): void => {
    const value = Number.parseFloat(this.confidenceThreshold.value);
    this.settingsStore.update((settings) => ({
      ...settings,
      input: { ...settings.input, minimumFootConfidence: value },
    }));
  };

  private readonly handleSample = (): void => {
    if (!this.cameraManager.isRunning()) return;
    this.cancelSample();
    const samples: number[] = [];
    const started = performance.now();
    this.sampleButton.disabled = true;
    this.useRecommendedButton.disabled = true;
    this.recommendedValue.textContent = "Sampling…";
    this.recommendationCopy.textContent = "Keep both feet visible and stand naturally for three seconds.";

    this.sampleTimer = window.setInterval(() => {
      const debug = this.cameraInput.getDebugState();
      if (debug.leftConfidence > 0 && debug.rightConfidence > 0) {
        samples.push(Math.min(debug.leftConfidence, debug.rightConfidence));
      }

      if (performance.now() - started >= SAMPLE_DURATION_MS) {
        this.cancelSample();
        this.finishSample(samples);
      }
    }, SAMPLE_INTERVAL_MS);
  };

  private readonly handleUseRecommended = (): void => {
    if (this.recommendedConfidence === null) return;
    const recommended = this.recommendedConfidence;
    this.settingsStore.update((settings) => ({
      ...settings,
      input: { ...settings.input, minimumFootConfidence: recommended },
    }));
    this.recommendationCopy.textContent = "Recommended confidence applied and saved.";
  };

  private async enableCamera(): Promise<void> {
    this.enableButton.disabled = true;
    this.setStatus("Requesting camera access…");
    try {
      const preferred = this.settingsStore.get().input.cameraDeviceId || undefined;
      await this.cameraManager.start(preferred);
      await this.cameraInput.initialize();
      this.cameraInput.setActive(true);
      const activeDevice = this.cameraManager.getSelectedDeviceId();
      if (activeDevice) {
        this.settingsStore.update((settings) => ({
          ...settings,
          input: { ...settings.input, cameraDeviceId: activeDevice },
        }));
      }
      this.updateCameraButtons(true);
      this.setStatus("Camera tracking is active. Keep both feet visible.");
    } catch (error) {
      console.error(error);
      this.cameraInput.setActive(false);
      this.updateCameraButtons(false);
      this.setStatus(error instanceof Error ? error.message : "Could not start the camera.", true);
    } finally {
      if (!this.cameraManager.isRunning()) this.enableButton.disabled = false;
    }
  }

  private startReadoutLoop(): void {
    if (this.updateHandle !== null) return;
    const update = (): void => {
      const debug = this.cameraInput.getDebugState();
      this.renderFoot(this.leftCard, this.leftState, this.leftMeter, this.leftConfidence, debug.leftConfidence, debug.leftVisible);
      this.renderFoot(this.rightCard, this.rightState, this.rightMeter, this.rightConfidence, debug.rightConfidence, debug.rightVisible);
      this.updateHandle = requestAnimationFrame(update);
    };
    this.updateHandle = requestAnimationFrame(update);
  }

  private stopReadoutLoop(): void {
    if (this.updateHandle !== null) cancelAnimationFrame(this.updateHandle);
    this.updateHandle = null;
  }

  private renderFoot(
    card: HTMLElement,
    state: HTMLElement,
    meter: HTMLElement,
    output: HTMLOutputElement,
    confidence: number,
    visible: boolean,
  ): void {
    const bounded = Math.min(Math.max(confidence, 0), 1);
    output.value = bounded.toFixed(2);
    meter.style.width = `${bounded * 100}%`;
    state.textContent = visible ? "Ready" : "Not detected";
    card.classList.toggle("calibration-foot-card--ready", visible);
  }

  private finishSample(samples: number[]): void {
    this.sampleButton.disabled = !this.cameraManager.isRunning();
    if (samples.length < 5) {
      this.recommendedConfidence = null;
      this.recommendedValue.textContent = "—";
      this.recommendationCopy.textContent = "Not enough stable foot detections. Adjust framing or landmark visibility and try again.";
      this.useRecommendedButton.disabled = true;
      return;
    }

    samples.sort((a, b) => a - b);
    const percentileIndex = Math.floor((samples.length - 1) * 0.15);
    const lowStableConfidence = samples[percentileIndex] ?? samples[0] ?? 0.5;
    const recommendation = Math.min(0.95, Math.max(0.2, Math.floor((lowStableConfidence - 0.08) * 20) / 20));
    this.recommendedConfidence = recommendation;
    this.recommendedValue.textContent = recommendation.toFixed(2);
    this.recommendationCopy.textContent = "Based on the lower end of your stable tracking, with a small safety margin for movement.";
    this.useRecommendedButton.disabled = false;
  }

  private cancelSample(): void {
    if (this.sampleTimer !== null) window.clearInterval(this.sampleTimer);
    this.sampleTimer = null;
    this.sampleButton.disabled = !this.cameraManager.isRunning();
  }

  private updateCameraButtons(running: boolean): void {
    this.enableButton.disabled = running;
    this.disableButton.disabled = !running;
    this.sampleButton.disabled = !running;
  }

  private setStatus(message: string, isError = false): void {
    this.status.textContent = message;
    this.status.classList.toggle("camera-status--error", isError);
  }

  private require<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Required calibration element not found: ${selector}`);
    return element;
  }
}
