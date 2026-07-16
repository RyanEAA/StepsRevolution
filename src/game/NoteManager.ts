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

    public removeFinishedNotes(
        notes: readonly TapNote[],
        gameTimeSeconds: number,
        removalDelaySeconds: number,
    ): TapNote[] {
        return notes.filter((note) => {
            if (!note.judged) {
                return true;
            }

            return (
                gameTimeSeconds <
                note.hitTimeSeconds +
                removalDelaySeconds
            );
        });
    }
}