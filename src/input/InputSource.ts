import type { FootState } from "../types/FootState";

export interface InputSource {
    /**
     * Starts or stops source-specific background work when the selected input
     * mode changes. Sources without background work may omit this method.
     */
    setActive?(active: boolean): void;

    /**
     * Updates the input source.
     *
     * @param deltaSeconds
     * Time elapsed since the previous animation frame.
     */
    update(deltaSeconds: number): void;

    /**
     * Returns the latest known positions of both feet.
     */
    getFootState(): FootState;

    /**
     * Removes event listeners or releases resources.
     */
    destroy(): void;
}
