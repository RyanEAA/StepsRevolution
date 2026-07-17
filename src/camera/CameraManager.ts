export type CameraStatus =
    | "idle"
    | "starting"
    | "running"
    | "stopped"
    | "error";

export type CameraStatusListener = (
    status: CameraStatus,
    message: string,
) => void;

export class CameraManager {
    private readonly videoElement: HTMLVideoElement;
    private readonly previewShell: HTMLElement | null;
    private readonly statusListeners = new Set<CameraStatusListener>();

    private stream: MediaStream | null = null;
    private selectedDeviceId: string | null = null;
    private destroyed = false;

    constructor(videoElement: HTMLVideoElement) {
        this.videoElement = videoElement;
        this.previewShell = videoElement.closest<HTMLElement>(
            ".camera-preview-shell",
        );

        navigator.mediaDevices?.addEventListener(
            "devicechange",
            this.handleDeviceChange,
        );
    }

    public subscribe(listener: CameraStatusListener): () => void {
        this.statusListeners.add(listener);

        return () => {
            this.statusListeners.delete(listener);
        };
    }

    public async listCameras(): Promise<MediaDeviceInfo[]> {
        this.ensureMediaDevicesAvailable();

        const devices = await navigator.mediaDevices.enumerateDevices();

        return devices.filter(
            (device) => device.kind === "videoinput",
        );
    }

    public async start(deviceId?: string): Promise<void> {
        this.ensureMediaDevicesAvailable();

        this.stop();
        this.emitStatus("starting", "Requesting camera access...");

        const videoConstraints: MediaTrackConstraints = deviceId
            ? {
                deviceId: { exact: deviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
            }
            : {
                facingMode: "user",
                width: { ideal: 1280 },
                height: { ideal: 720 },
            };

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: videoConstraints,
            });

            if (this.destroyed) {
                for (const track of stream.getTracks()) {
                    track.stop();
                }

                return;
            }

            this.stream = stream;

            const videoTrack = stream.getVideoTracks()[0];
            this.selectedDeviceId =
                videoTrack?.getSettings().deviceId ?? deviceId ?? null;

            for (const track of stream.getVideoTracks()) {
                track.addEventListener("ended", this.handleTrackEnded);
            }

            this.videoElement.srcObject = stream;
            await this.videoElement.play();

            this.previewShell?.classList.add(
                "camera-preview-shell--active",
            );

            this.emitStatus("running", "Camera preview is active.");
        } catch (error) {
            this.stop();
            const message = this.describeCameraError(error);
            this.emitStatus("error", message);
            throw new Error(message, { cause: error });
        }
    }

    public stop(): void {
        if (this.stream) {
            for (const track of this.stream.getTracks()) {
                track.removeEventListener("ended", this.handleTrackEnded);
                track.stop();
            }
        }

        this.stream = null;
        this.videoElement.pause();
        this.videoElement.srcObject = null;

        this.previewShell?.classList.remove(
            "camera-preview-shell--active",
        );

        if (!this.destroyed) {
            this.emitStatus("stopped", "Camera preview is stopped.");
        }
    }

    public isRunning(): boolean {
        return this.stream !== null &&
            this.stream.getVideoTracks().some(
                (track) => track.readyState === "live",
            );
    }

    public getSelectedDeviceId(): string | null {
        return this.selectedDeviceId;
    }

    public setMirrored(mirrored: boolean): void {
        this.videoElement.classList.toggle(
            "camera-preview--mirrored",
            mirrored,
        );
    }

    public destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.stop();

        navigator.mediaDevices?.removeEventListener(
            "devicechange",
            this.handleDeviceChange,
        );

        this.statusListeners.clear();
    }

    private readonly handleTrackEnded = (): void => {
        this.stop();
        this.emitStatus(
            "error",
            "The camera disconnected or stopped providing video.",
        );
    };

    private readonly handleDeviceChange = (): void => {
        if (!this.isRunning()) {
            return;
        }

        void this.verifyActiveCameraStillExists();
    };

    private async verifyActiveCameraStillExists(): Promise<void> {
        const selectedDeviceId = this.selectedDeviceId;

        if (!selectedDeviceId) {
            return;
        }

        const cameras = await this.listCameras();
        const stillAvailable = cameras.some(
            (camera) => camera.deviceId === selectedDeviceId,
        );

        if (!stillAvailable) {
            this.stop();
            this.emitStatus(
                "error",
                "The selected camera is no longer available.",
            );
        }
    }

    private ensureMediaDevicesAvailable(): void {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
                "Camera access is unavailable in this browser or context. Use HTTPS or localhost.",
            );
        }
    }

    private describeCameraError(error: unknown): string {
        if (!(error instanceof DOMException)) {
            return "The camera could not be started.";
        }

        switch (error.name) {
            case "NotAllowedError":
            case "SecurityError":
                return "Camera permission was denied. Allow camera access in the browser and try again.";
            case "NotFoundError":
            case "DevicesNotFoundError":
                return "No camera was found.";
            case "NotReadableError":
            case "TrackStartError":
                return "The camera is unavailable or already in use by another application.";
            case "OverconstrainedError":
            case "ConstraintNotSatisfiedError":
                return "The selected camera does not support the requested settings.";
            case "AbortError":
                return "Camera startup was interrupted.";
            default:
                return `The camera could not be started (${error.name}).`;
        }
    }

    private emitStatus(status: CameraStatus, message: string): void {
        for (const listener of this.statusListeners) {
            listener(status, message);
        }
    }
}
