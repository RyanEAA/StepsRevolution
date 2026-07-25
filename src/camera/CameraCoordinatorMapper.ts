export class CameraCoordinateMapper {
    private readonly videoElement: HTMLVideoElement;
    private readonly displayElement: HTMLElement;

    private mirrored = true;

    constructor(
        videoElement: HTMLVideoElement,
        displayElement: HTMLElement,
    ) {
        this.videoElement = videoElement;
        this.displayElement = displayElement;
    }

    public setMirrored(
        mirrored: boolean,
    ): void {
        this.mirrored = mirrored;
    }

    public mapXToDisplay(
        sourceX: number,
    ): number {
        const videoWidth =
            this.videoElement.videoWidth;

        const videoHeight =
            this.videoElement.videoHeight;

        const displayWidth =
            this.displayElement.clientWidth;

        const displayHeight =
            this.displayElement.clientHeight;

        if (
            videoWidth <= 0 ||
            videoHeight <= 0 ||
            displayWidth <= 0 ||
            displayHeight <= 0
        ) {
            return 0.5;
        }

        /*
         * The preview uses object-fit: cover.
         *
         * Determine how large the source video becomes when scaled
         * enough to completely cover the destination rectangle.
         */
        const scale = Math.max(
            displayWidth / videoWidth,
            displayHeight / videoHeight,
        );

        const renderedWidth =
            videoWidth * scale;

        /*
         * object-fit: cover centers the oversized video, so the
         * excess width is cropped equally from both sides.
         */
        const offsetX =
            (displayWidth - renderedWidth) / 2;

        const transformedSourceX =
            this.mirrored
                ? 1 - sourceX
                : sourceX;

        const displayPixelX =
            offsetX +
            transformedSourceX * renderedWidth;

        const normalizedDisplayX =
            displayPixelX / displayWidth;

        return this.clamp(
            normalizedDisplayX,
            0,
            1,
        );
    }

    private clamp(
        value: number,
        minimum: number,
        maximum: number,
    ): number {
        return Math.min(
            Math.max(value, minimum),
            maximum,
        );
    }
}