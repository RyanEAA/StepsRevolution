import type { FootState } from "../types/FootState";

export interface InputSource {
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