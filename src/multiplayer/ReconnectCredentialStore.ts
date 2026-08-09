import { PROTOCOL_VERSION } from "../../shared/constants";
import {
    sessionCredentialsSchema,
} from "../../shared/schemas";
import type { SessionCredentials } from "../../shared/schemas";

interface StoredSessionCredentials extends SessionCredentials {
    protocolVersion: typeof PROTOCOL_VERSION;
}

const STORAGE_KEY = "dance-vision.multiplayer-session.v1";

export class ReconnectCredentialStore {
    private readonly storage: Storage;

    public constructor(storage: Storage) {
        this.storage = storage;
    }

    public save(credentials: SessionCredentials): void {
        const stored: StoredSessionCredentials = {
            protocolVersion: PROTOCOL_VERSION,
            ...credentials,
        };

        try {
            this.storage.setItem(
                STORAGE_KEY,
                JSON.stringify(stored),
            );
        } catch {
            // Reconnection remains optional when storage is unavailable.
        }
    }

    public load(): SessionCredentials | null {
        let rawValue: string | null;

        try {
            rawValue = this.storage.getItem(STORAGE_KEY);
        } catch {
            return null;
        }

        if (!rawValue) {
            return null;
        }

        try {
            const parsedValue: unknown = JSON.parse(rawValue);

            if (
                typeof parsedValue !== "object" ||
                parsedValue === null ||
                !("protocolVersion" in parsedValue) ||
                parsedValue.protocolVersion !== PROTOCOL_VERSION
            ) {
                this.clear();
                return null;
            }

            const parsed = sessionCredentialsSchema.safeParse({
                roomId: "roomId" in parsedValue
                    ? parsedValue.roomId
                    : undefined,
                playerId: "playerId" in parsedValue
                    ? parsedValue.playerId
                    : undefined,
                reconnectToken: "reconnectToken" in parsedValue
                    ? parsedValue.reconnectToken
                    : undefined,
            });

            if (!parsed.success) {
                this.clear();
                return null;
            }

            return parsed.data;
        } catch {
            this.clear();
            return null;
        }
    }

    public clear(): void {
        try {
            this.storage.removeItem(STORAGE_KEY);
        } catch {
            // Nothing else is required when storage is unavailable.
        }
    }
}
