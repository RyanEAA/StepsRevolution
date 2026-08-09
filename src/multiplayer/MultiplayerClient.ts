import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";

import {
    clientCommandSchema,
    serverMessageSchema,
} from "../../shared/schemas";
import type {
    ClientCommand,
    ServerMessage,
} from "../../shared/schemas";

export type MultiplayerConnectionState =
    | "offline"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected";

interface ServerToClientEvents {
    message: (message: unknown) => void;
}

interface ClientToServerEvents {
    command: (
        command: ClientCommand,
        acknowledge: (message: unknown) => void,
    ) => void;
}

export type MultiplayerSocket = Socket<
    ServerToClientEvents,
    ClientToServerEvents
>;

export interface MultiplayerClientOptions {
    serverUrl: string;
    commandTimeoutMs?: number;
    socketFactory?: (serverUrl: string) => MultiplayerSocket;
}

interface PendingCommand {
    timer: ReturnType<typeof setTimeout>;
    reject: (reason: Error) => void;
}

export class MultiplayerClientError extends Error {
    public readonly code:
        | "not-connected"
        | "invalid-command"
        | "invalid-response"
        | "duplicate-command"
        | "command-timeout"
        | "connection-lost";

    public constructor(
        code:
            | "not-connected"
            | "invalid-command"
            | "invalid-response"
            | "duplicate-command"
            | "command-timeout"
            | "connection-lost",
        message: string,
    ) {
        super(message);
        this.name = "MultiplayerClientError";
        this.code = code;
    }
}

export class MultiplayerClient {
    private readonly socket: MultiplayerSocket;
    private readonly commandTimeoutMs: number;
    private readonly connectionListeners =
        new Set<(state: MultiplayerConnectionState) => void>();
    private readonly messageListeners =
        new Set<(message: ServerMessage) => void>();
    private readonly pendingCommands =
        new Map<string, PendingCommand>();

    private connectionState: MultiplayerConnectionState = "offline";
    private everConnected = false;
    private destroyed = false;
    private intentionalDisconnect = false;

    public constructor(options: MultiplayerClientOptions) {
        this.commandTimeoutMs = options.commandTimeoutMs ?? 8_000;
        this.socket = options.socketFactory
            ? options.socketFactory(options.serverUrl)
            : io(options.serverUrl, {
                autoConnect: false,
                reconnection: true,
                transports: ["websocket", "polling"],
            });

        this.socket.on("connect", this.handleConnect);
        this.socket.on("disconnect", this.handleDisconnect);
        this.socket.on("connect_error", this.handleConnectError);
        this.socket.on("message", this.handleMessage);
        this.socket.io.on(
            "reconnect_attempt",
            this.handleReconnectAttempt,
        );
    }

    public getConnectionState(): MultiplayerConnectionState {
        return this.connectionState;
    }

    public async connect(): Promise<void> {
        if (this.destroyed) {
            throw new Error("The multiplayer client has been destroyed.");
        }

        if (this.socket.connected) {
            this.setConnectionState("connected");
            return;
        }

        this.intentionalDisconnect = false;
        this.setConnectionState(
            this.everConnected ? "reconnecting" : "connecting",
        );

        await new Promise<void>((resolve, reject) => {
            const handleConnected = () => {
                this.socket.off("connect_error", handleError);
                resolve();
            };
            const handleError = (error: Error) => {
                this.socket.off("connect", handleConnected);
                reject(error);
            };

            this.socket.once("connect", handleConnected);
            this.socket.once("connect_error", handleError);
            this.socket.connect();
        });
    }

    public disconnect(): void {
        this.intentionalDisconnect = true;
        this.rejectPendingCommands(
            new MultiplayerClientError(
                "connection-lost",
                "The multiplayer connection was closed.",
            ),
        );
        this.socket.disconnect();
        this.setConnectionState("offline");
    }

    public async send(command: ClientCommand): Promise<ServerMessage> {
        const parsedCommand = clientCommandSchema.safeParse(command);

        if (!parsedCommand.success) {
            throw new MultiplayerClientError(
                "invalid-command",
                "The outgoing multiplayer command is invalid.",
            );
        }

        if (!this.socket.connected) {
            throw new MultiplayerClientError(
                "not-connected",
                "Connect to the multiplayer server before sending commands.",
            );
        }

        if (this.pendingCommands.has(parsedCommand.data.commandId)) {
            throw new MultiplayerClientError(
                "duplicate-command",
                "A command with this ID is already pending.",
            );
        }

        return new Promise<ServerMessage>((resolve, reject) => {
            const commandId = parsedCommand.data.commandId;
            const timer = setTimeout(() => {
                this.pendingCommands.delete(commandId);
                reject(new MultiplayerClientError(
                    "command-timeout",
                    "The multiplayer command timed out.",
                ));
            }, this.commandTimeoutMs);

            this.pendingCommands.set(commandId, { timer, reject });

            this.socket.emit(
                "command",
                parsedCommand.data,
                (rawResponse) => {
                    const pending =
                        this.pendingCommands.get(commandId);

                    if (!pending) {
                        return;
                    }

                    clearTimeout(pending.timer);
                    this.pendingCommands.delete(commandId);

                    const parsedResponse =
                        serverMessageSchema.safeParse(rawResponse);

                    if (!parsedResponse.success) {
                        reject(new MultiplayerClientError(
                            "invalid-response",
                            "The multiplayer server returned an invalid response.",
                        ));
                        return;
                    }

                    resolve(parsedResponse.data);
                },
            );
        });
    }

    public subscribeConnection(
        listener: (state: MultiplayerConnectionState) => void,
    ): () => void {
        this.connectionListeners.add(listener);
        listener(this.connectionState);

        return () => {
            this.connectionListeners.delete(listener);
        };
    }

    public subscribeMessages(
        listener: (message: ServerMessage) => void,
    ): () => void {
        this.messageListeners.add(listener);

        return () => {
            this.messageListeners.delete(listener);
        };
    }

    public destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.disconnect();

        this.socket.off("connect", this.handleConnect);
        this.socket.off("disconnect", this.handleDisconnect);
        this.socket.off("connect_error", this.handleConnectError);
        this.socket.off("message", this.handleMessage);
        this.socket.io.off(
            "reconnect_attempt",
            this.handleReconnectAttempt,
        );

        this.connectionListeners.clear();
        this.messageListeners.clear();
    }

    private readonly handleConnect = (): void => {
        this.everConnected = true;
        this.setConnectionState("connected");
    };

    private readonly handleDisconnect = (): void => {
        this.rejectPendingCommands(
            new MultiplayerClientError(
                "connection-lost",
                "The multiplayer connection was interrupted.",
            ),
        );

        if (this.intentionalDisconnect || this.destroyed) {
            this.setConnectionState("offline");
            return;
        }

        this.setConnectionState(
            this.socket.active ? "reconnecting" : "disconnected",
        );
    };

    private readonly handleConnectError = (): void => {
        this.setConnectionState(
            this.everConnected ? "reconnecting" : "disconnected",
        );
    };

    private readonly handleReconnectAttempt = (): void => {
        this.setConnectionState(
            this.everConnected ? "reconnecting" : "connecting",
        );
    };

    private readonly handleMessage = (rawMessage: unknown): void => {
        const parsed = serverMessageSchema.safeParse(rawMessage);

        if (!parsed.success) {
            return;
        }

        for (const listener of this.messageListeners) {
            listener(parsed.data);
        }
    };

    private setConnectionState(
        state: MultiplayerConnectionState,
    ): void {
        if (state === this.connectionState) {
            return;
        }

        this.connectionState = state;

        for (const listener of this.connectionListeners) {
            listener(state);
        }
    }

    private rejectPendingCommands(error: Error): void {
        for (const pending of this.pendingCommands.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingCommands.clear();
    }
}

export interface MultiplayerTransport {
    getConnectionState(): MultiplayerConnectionState;
    connect(): Promise<void>;
    disconnect(): void;
    send(command: ClientCommand): Promise<ServerMessage>;
    subscribeConnection(
        listener: (state: MultiplayerConnectionState) => void,
    ): () => void;
    subscribeMessages(
        listener: (message: ServerMessage) => void,
    ): () => void;
    destroy(): void;
}
