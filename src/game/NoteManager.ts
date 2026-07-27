import type {
    Lane,
    TapNote,
} from "../types/Note";

export interface ChartNoteDefinition {
    lane: Lane;
    hitTimeSeconds: number;
}

export class NoteManager {
    private nextNoteId = 1;

    public createNotes(
        definitions: readonly ChartNoteDefinition[],
    ): TapNote[] {
        this.nextNoteId = 1;

        return definitions
            .map((definition) => ({
                id: this.nextNoteId++,
                lane: definition.lane,
                hitTimeSeconds:
                    definition.hitTimeSeconds,
                judged: false,
                judgment: null,
            }))
            .sort(
                (left, right) =>
                    left.hitTimeSeconds -
                    right.hitTimeSeconds,
            );
    }

    public pruneFinishedNotes(
        notes: TapNote[],
        gameTimeSeconds: number,
        removalDelaySeconds: number,
    ): void {
        /*
         * Notes are sorted by hit time. Once the leading note is not
         * ready for removal, no later note can be ready either.
         */
        let removalCount = 0;

        while (removalCount < notes.length) {
            const note = notes[removalCount];

            if (
                note === undefined ||
                !note.judged ||
                gameTimeSeconds <
                    note.hitTimeSeconds +
                        removalDelaySeconds
            ) {
                break;
            }

            removalCount += 1;
        }

        if (removalCount === 0) {
            return;
        }

        notes.copyWithin(0, removalCount);
        notes.length -= removalCount;
    }
}