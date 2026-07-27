export interface DisplayPoint {
    x: number;
    y: number;
}

export class CameraCoordinateMapper {
    private readonly videoElement: HTMLVideoElement;
    private readonly displayElement: HTMLElement;

    private mirrored = true;

    private displayGeometry:
        DisplayGeometry | null = null;

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

    public refreshDisplayGeometry(): void {
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
            this.displayGeometry = null;
            return;
        }

        /*
         * Matches object-fit: cover.
         */
        const scale = Math.max(
            displayWidth / videoWidth,
            displayHeight / videoHeight,
        );

        const renderedWidth =
            videoWidth * scale;

        const renderedHeight =
            videoHeight * scale;

        const offsetX =
            (displayWidth - renderedWidth) / 2;

        const offsetY =
            (displayHeight - renderedHeight) / 2;

        /*
         * Store normalized geometry so each landmark mapping
         * avoids repeating divisions by the display dimensions.
         */
        this.displayGeometry = {
            normalizedOffsetX:
                offsetX / displayWidth,

            normalizedOffsetY:
                offsetY / displayHeight,

            normalizedRenderedWidth:
                renderedWidth / displayWidth,

            normalizedRenderedHeight:
                renderedHeight / displayHeight,
        };
    }

    public mapXToDisplay(
        sourceX: number,
    ): number {
        const geometry = this.displayGeometry;

        if (!geometry) {
            return 0.5;
        }

        const transformedSourceX =
            this.mirrored
                ? 1 - sourceX
                : sourceX;

        return this.clamp(
            geometry.normalizedOffsetX +
            transformedSourceX *
            geometry.normalizedRenderedWidth,
            0,
            1,
        );
    }

    public mapPointToDisplay(
        sourceX: number,
        sourceY: number,
    ): DisplayPoint {
        const geometry = this.displayGeometry;

        if (!geometry) {
            return {
                x: 0.5,
                y: 0.5,
            };
        }

        const transformedSourceX =
            this.mirrored
                ? 1 - sourceX
                : sourceX;

        return {
            x: this.clamp(
                geometry.normalizedOffsetX +
                transformedSourceX *
                geometry.normalizedRenderedWidth,
                0,
                1,
            ),

            y: this.clamp(
                geometry.normalizedOffsetY +
                sourceY *
                geometry.normalizedRenderedHeight,
                0,
                1,
            ),
        };
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

interface DisplayGeometry {
    normalizedOffsetX: number;
    normalizedOffsetY: number;

    normalizedRenderedWidth: number;
    normalizedRenderedHeight: number;
}
