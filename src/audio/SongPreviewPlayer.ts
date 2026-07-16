export interface PreviewOptions {
    startSeconds: number;
    durationSeconds: number;
}

export class SongPreviewPlayer {
    private readonly audio = new Audio();

    private objectUrl: string | null = null;
    private stopTimerId: number | null = null;

    public constructor() {
        this.audio.preload = "auto";
    }

    public async play(
        file: File,
        options: PreviewOptions,
    ): Promise<void> {
        this.stop();

        this.objectUrl = URL.createObjectURL(file);
        this.audio.src = this.objectUrl;

        const startSeconds = Math.max(
            0,
            options.startSeconds,
        );

        const durationSeconds = Math.max(
            1,
            options.durationSeconds,
        );

        await this.waitForMetadata();

        this.audio.currentTime = Math.min(
            startSeconds,
            Math.max(0, this.audio.duration - 0.1),
        );

        await this.audio.play();

        this.stopTimerId = window.setTimeout(
            () => {
                this.stop();
            },
            durationSeconds * 1000,
        );
    }

    public stop(): void {
        if (this.stopTimerId !== null) {
            window.clearTimeout(this.stopTimerId);
            this.stopTimerId = null;
        }

        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();

        if (this.objectUrl) {
            URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
    }

    public destroy(): void {
        this.stop();
    }

    private async waitForMetadata(): Promise<void> {
        if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            const handleLoaded = (): void => {
                cleanUp();
                resolve();
            };

            const handleError = (): void => {
                cleanUp();

                reject(
                    new Error(
                        "The song preview could not be loaded.",
                    ),
                );
            };

            const cleanUp = (): void => {
                this.audio.removeEventListener(
                    "loadedmetadata",
                    handleLoaded,
                );

                this.audio.removeEventListener(
                    "error",
                    handleError,
                );
            };

            this.audio.addEventListener(
                "loadedmetadata",
                handleLoaded,
                { once: true },
            );

            this.audio.addEventListener(
                "error",
                handleError,
                { once: true },
            );
        });
    }
}