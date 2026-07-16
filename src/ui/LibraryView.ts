import type {
    SongEntry,
    SongLibrary,
    SongPack,
} from "../types/Library";

export interface LibraryViewCallbacks {
    onPackSelected(pack: SongPack): void;
    onSongSelected(song: SongEntry): void;
}

export class LibraryView {
    private readonly packContainer: HTMLElement;
    private readonly songContainer: HTMLElement;
    private readonly songSectionTitle: HTMLElement;
    private readonly callbacks: LibraryViewCallbacks;

    private library: SongLibrary | null = null;
    private selectedPack: SongPack | null = null;
    private selectedSongId: string | null = null;

    public constructor(
        packContainer: HTMLElement,
        songContainer: HTMLElement,
        songSectionTitle: HTMLElement,
        callbacks: LibraryViewCallbacks,
    ) {
        this.packContainer = packContainer;
        this.songContainer = songContainer;
        this.songSectionTitle = songSectionTitle;
        this.callbacks = callbacks;
    }

    public setLibrary(
        library: SongLibrary,
    ): void {
        this.library = library;
        this.selectedPack = null;
        this.selectedSongId = null;

        this.songContainer.replaceChildren();
        this.songSectionTitle.textContent =
            "Select a song";

        this.renderPacks();
    }

    public clear(): void {
        this.library = null;
        this.selectedPack = null;
        this.selectedSongId = null;

        this.packContainer.replaceChildren();
        this.songContainer.replaceChildren();

        this.songSectionTitle.textContent =
            "Select a song";
    }

    public showPack(
        pack: SongPack,
    ): void {
        this.selectedPack = pack;
        this.selectedSongId = null;

        this.songSectionTitle.textContent =
            pack.name;

        this.renderSongs(pack);
    }

    public clearSelectedSong(): void {
        this.selectedSongId = null;

        if (this.selectedPack) {
            this.renderSongs(this.selectedPack);
        }
    }

    /**
     * Compatibility alias for older main.ts code.
     *
     * This no longer collapses an expanded card because cards do not
     * expand anymore. It simply clears the selected-card highlight.
     */
    public collapseExpandedSong(): void {
        this.clearSelectedSong();
    }

    public getSelectedPack(): SongPack | null {
        return this.selectedPack;
    }

    public getSelectedSong(): SongEntry | null {
        if (!this.selectedPack || !this.selectedSongId) {
            return null;
        }

        return (
            this.selectedPack.songs.find(
                (song) =>
                    song.id === this.selectedSongId,
            ) ?? null
        );
    }

    public getLibrary(): SongLibrary | null {
        return this.library;
    }

    private renderPacks(): void {
        this.packContainer.replaceChildren();

        if (!this.library) {
            return;
        }

        for (const pack of this.library.packs) {
            const card =
                document.createElement("button");

            card.type = "button";
            card.className =
                "library-card pack-card";

            card.append(
                this.createArtwork(
                    pack.artworkUrl,
                    pack.name,
                ),
            );

            const content =
                document.createElement("div");

            content.className =
                "library-card__content";

            const title =
                document.createElement("h3");

            title.textContent = pack.name;

            const details =
                document.createElement("p");

            details.textContent =
                `${pack.songs.length} ${pack.songs.length === 1
                    ? "song"
                    : "songs"
                }`;

            content.append(
                title,
                details,
            );

            card.append(content);

            card.addEventListener(
                "click",
                () => {
                    this.showPack(pack);

                    this.callbacks.onPackSelected(
                        pack,
                    );
                },
            );

            this.packContainer.append(card);
        }
    }

    private renderSongs(
        pack: SongPack,
    ): void {
        this.songContainer.replaceChildren();

        for (const song of pack.songs) {
            const card =
                document.createElement("article");

            card.className =
                "library-card song-card";

            card.dataset.songId =
                song.id;

            const isSelected =
                song.id === this.selectedSongId;

            if (isSelected) {
                card.classList.add(
                    "song-card--selected",
                );
            }

            if (!song.audioFile) {
                card.classList.add(
                    "library-card--unavailable",
                );
            }

            const summaryButton =
                document.createElement("button");

            summaryButton.type = "button";
            summaryButton.className =
                "song-card__summary";

            summaryButton.setAttribute(
                "aria-pressed",
                isSelected
                    ? "true"
                    : "false",
            );

            summaryButton.setAttribute(
                "aria-label",
                `Select ${song.title} by ${song.artist}`,
            );

            summaryButton.append(
                this.createArtwork(
                    song.bannerUrl,
                    song.title,
                ),
            );

            const content =
                document.createElement("div");

            content.className =
                "library-card__content";

            const title =
                document.createElement("h3");

            title.textContent =
                song.title;

            const artist =
                document.createElement("p");

            artist.textContent =
                song.artist;

            const details =
                document.createElement("span");

            details.className =
                "library-card__details";

            const chartCount =
                song.simfile.charts.length;

            details.textContent =
                `${chartCount} ${chartCount === 1
                    ? "difficulty"
                    : "difficulties"
                }`;

            if (!song.audioFile) {
                details.textContent +=
                    " · Missing audio";
            }

            content.append(
                title,
                artist,
                details,
            );

            summaryButton.append(content);
            card.append(summaryButton);

            summaryButton.addEventListener(
                "click",
                () => {
                    this.selectSong(
                        pack,
                        song,
                    );
                },
            );

            this.songContainer.append(card);
        }
    }

    private selectSong(
        pack: SongPack,
        song: SongEntry,
    ): void {
        this.selectedSongId = song.id;

        /*
         * Re-rendering only changes the selected highlight. Card sizes
         * remain unchanged, so the grid does not jump or reflow.
         */
        this.renderSongs(pack);

        this.callbacks.onSongSelected(song);
    }

    private createArtwork(
        imageUrl: string | null,
        label: string,
    ): HTMLElement {
        const artwork =
            document.createElement("div");

        artwork.className =
            "library-card__artwork";

        if (imageUrl) {
            const image =
                document.createElement("img");

            image.src = imageUrl;
            image.alt =
                `${label} artwork`;

            image.loading = "lazy";

            artwork.append(image);

            return artwork;
        }

        const placeholder =
            document.createElement("span");

        placeholder.textContent =
            label
                .trim()
                .slice(0, 1)
                .toUpperCase() || "?";

        artwork.append(placeholder);

        return artwork;
    }
}