import type { SongEntry } from "../types/Library";

export interface SongDialogViewCallbacks {
  onCloseRequested(): void;
  onDifficultySelected(chartIndex: number): void;
  onPlayRequested(): void;
}

export class SongDialogView {
  private readonly dialog: HTMLDialogElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly image: HTMLImageElement;
  private readonly title: HTMLElement;
  private readonly artist: HTMLElement;
  private readonly bpm: HTMLElement;
  private readonly pack: HTMLElement;
  private readonly previewStatus: HTMLElement;
  private readonly difficultyList: HTMLElement;
  private readonly playButton: HTMLButtonElement;

  private callbacks: SongDialogViewCallbacks | null = null;

  public constructor() {
    this.dialog = this.requireElement<HTMLDialogElement>("#selected-song-dialog");
    this.closeButton = this.requireElement<HTMLButtonElement>("#close-song-dialog-button");
    this.image = this.requireElement<HTMLImageElement>("#selected-song-image");
    this.title = this.requireElement<HTMLElement>("#selected-song-title");
    this.artist = this.requireElement<HTMLElement>("#selected-song-artist");
    this.bpm = this.requireElement<HTMLElement>("#selected-song-bpm");
    this.pack = this.requireElement<HTMLElement>("#selected-song-pack");
    this.previewStatus = this.requireElement<HTMLElement>("#selected-song-preview-status");
    this.difficultyList = this.requireElement<HTMLElement>("#library-difficulty-list");
    this.playButton = this.requireElement<HTMLButtonElement>("#play-selected-song-button");
  }

  public initialize(callbacks: SongDialogViewCallbacks): void {
    this.callbacks = callbacks;

    this.closeButton.addEventListener("click", this.handleCloseClick);
    this.dialog.addEventListener("cancel", this.handleCancel);
    this.dialog.addEventListener("click", this.handleDialogClick);
    this.difficultyList.addEventListener("click", this.handleDifficultyClick);
    this.playButton.addEventListener("click", this.handlePlayClick);
  }

  public showSong(song: SongEntry, bpmLabel: string): void {
    this.title.textContent = song.title;
    this.artist.textContent = song.artist;
    this.pack.textContent = `Pack: ${song.packName}`;
    this.bpm.textContent = bpmLabel;

    if (song.bannerUrl) {
      this.image.src = song.bannerUrl;
      this.image.alt = `${song.title} banner`;
      this.image.hidden = false;
    } else {
      this.image.removeAttribute("src");
      this.image.alt = "";
      this.image.hidden = true;
    }

    this.renderDifficulties(song);
    this.playButton.disabled = true;
  }

  public open(): void {
    this.image.hidden = false;

    if (!this.dialog.open) {
      this.dialog.showModal();
    }
  }

  public close(): void {
    if (this.dialog.open) {
      this.dialog.close();
    }
  }

  public isOpen(): boolean {
    return this.dialog.open;
  }

  public setPreviewStatus(status: string): void {
    if (this.previewStatus.textContent !== status) {
      this.previewStatus.textContent = status;
    }
  }

  public selectDifficulty(chartIndex: number, canPlay: boolean): void {
    for (const button of this.difficultyList.querySelectorAll<HTMLButtonElement>(".difficulty-button")) {
      const isSelected = Number.parseInt(button.dataset.chartIndex ?? "-1", 10) === chartIndex;
      button.classList.toggle("difficulty-button--selected", isSelected);
    }

    this.playButton.disabled = !canPlay;
  }

  public destroy(): void {
    this.closeButton.removeEventListener("click", this.handleCloseClick);
    this.dialog.removeEventListener("cancel", this.handleCancel);
    this.dialog.removeEventListener("click", this.handleDialogClick);
    this.difficultyList.removeEventListener("click", this.handleDifficultyClick);
    this.playButton.removeEventListener("click", this.handlePlayClick);
    this.callbacks = null;
  }

  private renderDifficulties(song: SongEntry): void {
    this.difficultyList.replaceChildren();

    song.simfile.charts.forEach((chart, chartIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "difficulty-button";
      button.dataset.chartIndex = chartIndex.toString();

      const name = document.createElement("span");
      name.className = "difficulty-button__name";
      name.textContent = chart.difficulty;

      const meter = document.createElement("strong");
      meter.className = "difficulty-button__meter";
      meter.textContent = chart.meter.toString();

      const noteCount = document.createElement("small");
      noteCount.textContent = `${chart.notes.length} taps`;

      button.append(name, meter, noteCount);
      this.difficultyList.append(button);
    });
  }

  private readonly handleCloseClick = (): void => {
    this.callbacks?.onCloseRequested();
  };

  private readonly handleCancel = (event: Event): void => {
    event.preventDefault();
    this.callbacks?.onCloseRequested();
  };

  private readonly handleDialogClick = (event: MouseEvent): void => {
    if (event.target === this.dialog) {
      this.callbacks?.onCloseRequested();
    }
  };

  private readonly handleDifficultyClick = (event: MouseEvent): void => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>(".difficulty-button");

    if (!button || !this.difficultyList.contains(button)) {
      return;
    }

    const chartIndex = Number.parseInt(button.dataset.chartIndex ?? "", 10);

    if (!Number.isInteger(chartIndex) || chartIndex < 0) {
      return;
    }

    this.callbacks?.onDifficultySelected(chartIndex);
  };

  private readonly handlePlayClick = (): void => {
    this.callbacks?.onPlayRequested();
  };

  private requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);

    if (!element) {
      throw new Error(`Required element was not found: ${selector}`);
    }

    return element;
  }
}
