export interface DisplayPoint {
    x: number;
    y: number;
}

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
        const geometry =
            this.getDisplayGeometry();

        if (!geometry) {
            return 0.5;
        }

        const transformedSourceX =
            this.mirrored
                ? 1 - sourceX
                : sourceX;

        const displayPixelX =
            geometry.offsetX +
            transformedSourceX *
            geometry.renderedWidth;

        return this.clamp(
            displayPixelX /
            geometry.displayWidth,
            0,
            1,
        );
    }

    public mapPointToDisplay(
        sourceX: number,
        sourceY: number,
    ): DisplayPoint {
        const geometry =
            this.getDisplayGeometry();

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

        const displayPixelX =
            geometry.offsetX +
            transformedSourceX *
            geometry.renderedWidth;

        const displayPixelY =
            geometry.offsetY +
            sourceY *
            geometry.renderedHeight;

        return {
            x: this.clamp(
                displayPixelX /
                geometry.displayWidth,
                0,
                1,
            ),

            y: this.clamp(
                displayPixelY /
                geometry.displayHeight,
                0,
                1,
            ),
        };
    }

    private getDisplayGeometry():
        DisplayGeometry | null {
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
            return null;
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
            (displayWidth -
                renderedWidth) /
            2;

        const offsetY =
            (displayHeight -
                renderedHeight) /
            2;

        return {
            displayWidth,
            displayHeight,
            renderedWidth,
            renderedHeight,
            offsetX,
            offsetY,
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
    displayWidth: number;
    displayHeight: number;

    renderedWidth: number;
    renderedHeight: number;

    offsetX: number;
    offsetY: number;
}