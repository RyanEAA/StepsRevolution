import type { RoomSessionState } from "../multiplayer/RoomSession";

export interface MultiplayerViewCallbacks {
    onSinglePlayer: () => void;
    onHostSelected: () => void;
    onJoinSelected: () => void;
    onHostSubmitted: (displayName: string) => void;
    onJoinSubmitted: (roomCode: string, displayName: string) => void;
    onCancelForm: () => void;
    onLeaveRoom: () => void;
    onKickPlayer: (playerId: string) => void;
    onSessionNavigation: () => void;
    onBrowseHostLibrary: () => void;
    onImportLocalLibrary: () => void;
    onBeginReadyCheck: () => void;
    onCancelReadyCheck: () => void;
    onSetReady: (ready: boolean) => void;
    onDifficultySelected: (chartId: string) => void;
    onRetrySongPreparation: () => void;
    onStartCountdown: () => void;
}

export class MultiplayerView {
    private readonly hostForm = this.require<HTMLFormElement>("#host-session-form");
    private readonly joinForm = this.require<HTMLFormElement>("#join-session-form");
    private readonly hostName = this.require<HTMLInputElement>("#host-display-name");
    private readonly joinName = this.require<HTMLInputElement>("#join-display-name");
    private readonly roomCodeInput = this.require<HTMLInputElement>("#join-room-code");
    private readonly status = this.require<HTMLElement>("#multiplayer-form-status");
    private readonly roomCode = this.require<HTMLElement>("#multiplayer-room-code");
    private readonly connectionStatus = this.require<HTMLElement>("#multiplayer-connection-status");
    private readonly playerCount = this.require<HTMLElement>("#lobby-player-count");
    private readonly playerList = this.require<HTMLUListElement>("#multiplayer-player-list");
    private readonly roleMessage = this.require<HTMLElement>("#lobby-role-message");
    private readonly hostSongSelectionButton = this.require<HTMLButtonElement>("#host-song-selection-button");
    private readonly localLibraryImportButton = this.require<HTMLButtonElement>("#local-library-import-button");
    private readonly beginReadyCheckButton = this.require<HTMLButtonElement>("#begin-ready-check-button");
    private readonly cancelReadyCheckButton = this.require<HTMLButtonElement>("#cancel-ready-check-button");
    private readonly playerReadyButton = this.require<HTMLButtonElement>("#player-ready-button");
    private readonly retrySongTransferButton = this.require<HTMLButtonElement>("#retry-song-transfer-button");
    private readonly startCountdownButton = this.require<HTMLButtonElement>("#start-countdown-button");
    private readonly readyCheckStatus = this.require<HTMLElement>("#ready-check-status");
    private readonly selectionRevision = this.require<HTMLElement>("#lobby-selection-revision");
    private readonly selectionEmpty = this.require<HTMLElement>("#lobby-selection-empty");
    private readonly selectionDetails = this.require<HTMLElement>("#lobby-selection-details");
    private readonly selectionSong = this.require<HTMLElement>("#lobby-selection-song");
    private readonly selectionArtist = this.require<HTMLElement>("#lobby-selection-artist");
    private readonly selectionChart = this.require<HTMLElement>("#lobby-selection-chart");
    private readonly selectionStatus = this.require<HTMLElement>("#lobby-selection-status");
    private readonly difficultySection = this.require<HTMLElement>("#lobby-difficulty-section");
    private readonly difficultyList = this.require<HTMLElement>("#lobby-difficulty-list");
    private readonly interactiveElements = Array.from(
        document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
            "#mode-selection-view button, #mode-selection-view input, #leave-room-button",
        ),
    );
    private callbacks: MultiplayerViewCallbacks | null = null;

    public initialize(callbacks: MultiplayerViewCallbacks): void {
        this.callbacks = callbacks;
        this.require("#single-player-mode-button").addEventListener("click", this.singlePlayer);
        this.require("#host-session-mode-button").addEventListener("click", this.hostSelected);
        this.require("#join-session-mode-button").addEventListener("click", this.joinSelected);
        this.require("#nav-session-button").addEventListener("click", this.sessionNavigation);
        this.require("#leave-room-button").addEventListener("click", this.leaveRoom);
        this.playerList.addEventListener("click", this.kickPlayer);
        this.hostSongSelectionButton.addEventListener("click", this.browseHostLibrary);
        this.localLibraryImportButton.addEventListener("click", this.importLocalLibrary);
        this.beginReadyCheckButton.addEventListener("click", this.beginReadyCheck);
        this.cancelReadyCheckButton.addEventListener("click", this.cancelReadyCheck);
        this.playerReadyButton.addEventListener("click", this.setReady);
        this.difficultyList.addEventListener("click", this.selectDifficulty);
        this.retrySongTransferButton.addEventListener("click", this.retrySongPreparation);
        this.startCountdownButton.addEventListener("click", this.startCountdown);
        this.hostForm.addEventListener("submit", this.submitHost);
        this.joinForm.addEventListener("submit", this.submitJoin);
        document.querySelectorAll(".session-form-cancel").forEach((button) => {
            button.addEventListener("click", this.cancelForm);
        });
    }

    public destroy(): void {
        this.require("#single-player-mode-button").removeEventListener("click", this.singlePlayer);
        this.require("#host-session-mode-button").removeEventListener("click", this.hostSelected);
        this.require("#join-session-mode-button").removeEventListener("click", this.joinSelected);
        this.require("#nav-session-button").removeEventListener("click", this.sessionNavigation);
        this.require("#leave-room-button").removeEventListener("click", this.leaveRoom);
        this.playerList.removeEventListener("click", this.kickPlayer);
        this.hostSongSelectionButton.removeEventListener("click", this.browseHostLibrary);
        this.localLibraryImportButton.removeEventListener("click", this.importLocalLibrary);
        this.beginReadyCheckButton.removeEventListener("click", this.beginReadyCheck);
        this.cancelReadyCheckButton.removeEventListener("click", this.cancelReadyCheck);
        this.playerReadyButton.removeEventListener("click", this.setReady);
        this.difficultyList.removeEventListener("click", this.selectDifficulty);
        this.retrySongTransferButton.removeEventListener("click", this.retrySongPreparation);
        this.startCountdownButton.removeEventListener("click", this.startCountdown);
        this.hostForm.removeEventListener("submit", this.submitHost);
        this.joinForm.removeEventListener("submit", this.submitJoin);
        document.querySelectorAll(".session-form-cancel").forEach((button) => {
            button.removeEventListener("click", this.cancelForm);
        });
        this.callbacks = null;
    }

    public showHostForm(): void {
        this.hostForm.hidden = false;
        this.joinForm.hidden = true;
        this.setStatus("");
        this.hostName.focus();
    }

    public showJoinForm(): void {
        this.hostForm.hidden = true;
        this.joinForm.hidden = false;
        this.setStatus("");
        this.joinName.focus();
    }

    public hideForms(): void {
        this.hostForm.hidden = true;
        this.joinForm.hidden = true;
        this.setStatus("");
    }

    public setPending(pending: boolean, message?: string): void {
        for (const element of this.interactiveElements) {
            element.disabled = pending;
        }
        if (message !== undefined) this.setStatus(message);
    }

    public setStatus(message: string): void {
        this.status.textContent = message;
    }

    public setSelectionStatus(message: string): void {
        this.selectionStatus.textContent = message;
    }

    public setReadyStatus(message: string): void {
        this.readyCheckStatus.textContent = message;
    }

    public renderSession(state: Readonly<RoomSessionState>): void {
        const connectionLabels = {
            offline: "Offline",
            connecting: "Connecting…",
            connected: "Connected",
            reconnecting: "Reconnecting…",
            disconnected: "Disconnected",
        } as const;
        this.connectionStatus.textContent = connectionLabels[state.connectionState];

        const room = state.room;
        if (!room) {
            return;
        }

        this.roomCode.textContent = room.roomCode;
        this.playerCount.textContent = `${room.players.length} ${room.players.length === 1 ? "player" : "players"}`;
        this.playerList.replaceChildren(...room.players.map((player) => {
            const item = document.createElement("li");
            item.className = "player-list__item";
            const name = document.createElement("span");
            name.textContent = player.displayLabel;
            const badges = document.createElement("span");
            badges.className = "player-list__badges";
            if (player.playerId === room.hostPlayerId) {
                badges.append(this.badge("Host"));
            }
            badges.append(this.badge(
                player.connectionStatus === "connected" ? "Connected" : "Disconnected",
                player.connectionStatus === "connected" ? "success" : "warning",
            ));
            badges.append(room.songPackage
                ? this.preparationBadge(player.assetPreparation?.status ?? "not-requested", player.chartChoice !== null)
                : this.availabilityBadge(player.availability.status, player.availability.audioReady));
            if (player.ready) {
                badges.append(this.badge("Ready", "success"));
            }
            if (player.winCount > 0) {
                badges.append(this.badge(
                    player.winCount === 1 ? "⭐" : `${player.winCount} × ⭐`,
                    "success",
                ));
            }
            if (
                state.localPlayerId === room.hostPlayerId &&
                player.playerId !== room.hostPlayerId &&
                (room.phase === "selecting" || room.phase === "ready-check" || room.phase === "results")
            ) {
                const kick = document.createElement("button");
                kick.type = "button";
                kick.className = "player-kick-button";
                kick.dataset.kickPlayerId = player.playerId;
                kick.textContent = "Kick";
                badges.append(kick);
            }
            item.append(name, badges);
            return item;
        }));

        this.roleMessage.textContent = state.localPlayerId === room.hostPlayerId
            ? "You are the host. Choose one song; every player chooses their own difficulty."
            : "The host chooses the song. You choose your own difficulty here.";
        this.hostSongSelectionButton.hidden =
            state.localPlayerId !== room.hostPlayerId;

        const localPlayer = room.players.find(
            (player) => player.playerId === state.localPlayerId,
        );
        const isHost = state.localPlayerId === room.hostPlayerId;
        this.localLibraryImportButton.hidden = true;
        this.retrySongTransferButton.hidden = localPlayer?.assetPreparation?.status !== "failed";
        const roomAvailabilityValid = room.songPackage !== null
            ? room.players.every((player) => player.connectionStatus === "connected" &&
                player.chartChoice?.selectionRevision === room.selectionRevision &&
                player.assetPreparation?.selectionRevision === room.selectionRevision &&
                player.assetPreparation.status === "prepared")
            : room.selection !== null && room.players.every((player) =>
                player.connectionStatus === "connected" && player.availability.status === "matching-chart" &&
                player.availability.audioReady && player.availability.selectionRevision === room.selectionRevision &&
                player.availability.chartHash === room.selection?.chartHash);
        this.beginReadyCheckButton.hidden =
            !isHost || room.phase !== "selecting";
        this.beginReadyCheckButton.disabled = !roomAvailabilityValid;
        this.cancelReadyCheckButton.hidden =
            !isHost || room.phase !== "ready-check";
        const canReady = room.phase === "ready-check" && (room.songPackage
            ? localPlayer?.chartChoice?.selectionRevision === room.selectionRevision &&
                localPlayer.assetPreparation?.status === "prepared"
            : localPlayer?.availability.status === "matching-chart" && localPlayer.availability.audioReady &&
                localPlayer.availability.selectionRevision === room.selectionRevision);
        this.playerReadyButton.hidden = room.phase !== "ready-check";
        this.playerReadyButton.disabled = !canReady;
        this.playerReadyButton.textContent = localPlayer?.ready
            ? "Not ready"
            : "Ready";
        this.playerReadyButton.dataset.ready = localPlayer?.ready
            ? "true"
            : "false";
        this.readyCheckStatus.textContent = this.readyStatusMessage(
            room.phase,
            roomAvailabilityValid,
            room.players.every((player) => player.ready),
        );
        const everyoneReady = room.players.every((player) => player.ready && player.clockQuality === "usable");
        this.startCountdownButton.hidden = !isHost || room.phase !== "ready-check" || !everyoneReady;

        const selection = room.selection;
        const songPackage = room.songPackage;
        this.selectionEmpty.hidden = selection !== null || songPackage !== null;
        this.selectionDetails.hidden = selection === null && songPackage === null;
        this.selectionRevision.textContent = songPackage
            ? `Song ${songPackage.selectionRevision}` : selection
            ? `Selection ${selection.selectionRevision}`
            : "Not selected";
        if (songPackage) {
            this.selectionSong.textContent = songPackage.title;
            this.selectionArtist.textContent = songPackage.artist || "Unknown artist";
            this.selectionChart.textContent = `${songPackage.charts.length} shared difficulties`;
            this.difficultySection.hidden = false;
            this.renderDifficulties(songPackage.charts, localPlayer?.chartChoice?.chartId ?? null,
                localPlayer?.assetPreparation?.status === "prepared");
        } else if (selection) {
            this.selectionSong.textContent = selection.title;
            this.selectionArtist.textContent = selection.artist || "Unknown artist";
            this.selectionChart.textContent =
                `${selection.difficulty} · Meter ${selection.meter} · ${selection.tapCount} taps`;
            this.difficultySection.hidden = true;
        } else {
            this.difficultySection.hidden = true;
            this.difficultyList.replaceChildren();
        }
    }

    private renderDifficulties(
        charts: import("../../shared/relaySchemas").SharedChartDescriptor[],
        selectedId: string | null,
        prepared: boolean,
    ): void {
        this.difficultyList.replaceChildren(...charts.map((chart) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "difficulty-button";
            button.classList.toggle("difficulty-button--selected", chart.chartId === selectedId);
            button.dataset.chartId = chart.chartId;
            button.disabled = !prepared;
            const name = document.createElement("span");
            name.className = "difficulty-button__name";
            name.textContent = chart.difficulty;
            const meter = document.createElement("strong");
            meter.className = "difficulty-button__meter";
            meter.textContent = String(chart.meter);
            const taps = document.createElement("small");
            taps.textContent = `${chart.tapCount} taps`;
            button.append(name, meter, taps);
            return button;
        }));
    }

    private preparationBadge(status: string, hasChoice: boolean): HTMLElement {
        if (status === "prepared") return this.badge(hasChoice ? "Difficulty chosen" : "Choose difficulty", hasChoice ? "success" : "warning");
        if (status === "failed") return this.badge("Download failed", "warning");
        if (status === "downloading" || status === "verifying") return this.badge("Preparing song", "neutral");
        return this.badge("Waiting for song", "neutral");
    }

    private badge(label: string, variant = "neutral"): HTMLElement {
        const badge = document.createElement("span");
        badge.className = `player-badge player-badge--${variant}`;
        badge.textContent = label;
        return badge;
    }

    private availabilityBadge(
        status: string,
        audioReady: boolean,
    ): HTMLElement {
        const labels: Record<string, [string, string]> = {
            unchecked: ["Not checked", "neutral"],
            checking: ["Checking", "neutral"],
            "matching-chart": ["Chart matched", "success"],
            "song-missing": ["Song missing", "warning"],
            "chart-missing": ["Chart missing", "warning"],
            "chart-mismatch": ["Chart mismatch", "warning"],
            error: ["Check failed", "warning"],
        };
        if (status === "matching-chart" && !audioReady) {
            return this.badge("Audio missing", "warning");
        }
        const [label, variant] = labels[status] ?? [status, "neutral"];
        return this.badge(label, variant);
    }

    private readyStatusMessage(
        phase: string,
        availabilityValid: boolean,
        everyoneReady: boolean,
    ): string {
        if (phase === "ready-check") {
            return everyoneReady
                ? "Everyone is ready. Clock synchronization comes next."
                : "Waiting for every player to become ready.";
        }
        return availabilityValid
            ? "Every player has the exact chart and local audio."
            : "Every player needs an exact chart match and local audio.";
    }

    private readonly singlePlayer = () => this.callbacks?.onSinglePlayer();
    private readonly hostSelected = () => this.callbacks?.onHostSelected();
    private readonly joinSelected = () => this.callbacks?.onJoinSelected();
    private readonly cancelForm = () => this.callbacks?.onCancelForm();
    private readonly leaveRoom = () => this.callbacks?.onLeaveRoom();
    private readonly sessionNavigation = () => this.callbacks?.onSessionNavigation();
    private readonly browseHostLibrary = () => this.callbacks?.onBrowseHostLibrary();
    private readonly importLocalLibrary = () => this.callbacks?.onImportLocalLibrary();
    private readonly beginReadyCheck = () => this.callbacks?.onBeginReadyCheck();
    private readonly cancelReadyCheck = () => this.callbacks?.onCancelReadyCheck();
    private readonly setReady = () => this.callbacks?.onSetReady(
        this.playerReadyButton.dataset.ready !== "true",
    );
    private readonly selectDifficulty = (event: MouseEvent): void => {
        const target = event.target instanceof Element
            ? event.target.closest<HTMLButtonElement>("[data-chart-id]")
            : null;
        if (target?.dataset.chartId) {
            this.callbacks?.onDifficultySelected(target.dataset.chartId);
        }
    };
    private readonly retrySongPreparation = (): void => {
        this.callbacks?.onRetrySongPreparation();
    };
    private readonly startCountdown = (): void => this.callbacks?.onStartCountdown();
    private readonly kickPlayer = (event: MouseEvent): void => {
        const button = event.target instanceof Element
            ? event.target.closest<HTMLButtonElement>("[data-kick-player-id]")
            : null;
        const playerId = button?.dataset.kickPlayerId;
        if (playerId) this.callbacks?.onKickPlayer(playerId);
    };
    private readonly submitHost = (event: SubmitEvent): void => {
        event.preventDefault();
        this.callbacks?.onHostSubmitted(this.hostName.value.trim());
    };
    private readonly submitJoin = (event: SubmitEvent): void => {
        event.preventDefault();
        this.callbacks?.onJoinSubmitted(
            this.roomCodeInput.value.trim().toUpperCase(),
            this.joinName.value.trim(),
        );
    };

    private require<T extends Element = HTMLElement>(selector: string): T {
        const element = document.querySelector<T>(selector);
        if (!element) throw new Error(`Required multiplayer element was not found: ${selector}`);
        return element;
    }
}
