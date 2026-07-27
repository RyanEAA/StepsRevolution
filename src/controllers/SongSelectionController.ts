import { SongPreviewPlayer } from "../audio/SongPreviewPlayer";
import type { StepManiaChart } from "../types/Chart";
import type { SongEntry } from "../types/Library";
import { LibraryView } from "../ui/LibraryView";
import { SongDialogView } from "../ui/SongDialogView";

export interface SongSelectionControllerCallbacks {
  onPlaySong(song: SongEntry, chart: StepManiaChart): void;
}

export class SongSelectionController {
  private readonly dialogView: SongDialogView;
  private readonly libraryView: LibraryView;
  private readonly previewPlayer = new SongPreviewPlayer();
  private readonly callbacks: SongSelectionControllerCallbacks;

  private selectedSong: SongEntry | null = null;
  private selectedChart: StepManiaChart | null = null;

  public constructor(
    dialogView: SongDialogView,
    libraryView: LibraryView,
    callbacks: SongSelectionControllerCallbacks,
  ) {
    this.dialogView = dialogView;
    this.libraryView = libraryView;
    this.callbacks = callbacks;
  }

  public initialize(): void {
    this.dialogView.initialize({
      onCloseRequested: (): void => {
        this.closeDialog();
      },
      onDifficultySelected: (chartIndex: number): void => {
        this.selectDifficulty(chartIndex);
      },
      onPlayRequested: (): void => {
        this.playSelectedSong();
      },
    });
  }

  public selectSong(song: SongEntry): void {
    this.previewPlayer.stop();

    this.selectedSong = song;
    this.selectedChart = null;

    this.dialogView.showSong(song, this.formatBpmRange(song.simfile.bpmSegments.map((segment) => segment.bpm)));
    this.dialogView.setPreviewStatus(song.audioFile ? "♪ Preview loading..." : "Preview unavailable");
    this.dialogView.open();

    void this.playPreview(song);
  }

  public handlePackSelected(): void {
    this.previewPlayer.stop();
    this.dialogView.close();
    this.selectedSong = null;
    this.selectedChart = null;
  }

  public closeDialog(clearSelection = false): void {
    this.previewPlayer.stop();
    this.dialogView.close();
    this.dialogView.setPreviewStatus("Preview stopped");

    if (clearSelection) {
      this.selectedSong = null;
      this.selectedChart = null;
      this.libraryView.clearSelectedSong();
    }
  }

  public clearSelection(): void {
    this.closeDialog(true);
  }

  public destroy(): void {
    this.previewPlayer.destroy();
    this.dialogView.destroy();
  }

  private selectDifficulty(chartIndex: number): void {
    const song = this.selectedSong;

    if (!song) {
      return;
    }

    const chart = song.simfile.charts[chartIndex];

    if (!chart) {
      return;
    }

    this.selectedChart = chart;
    this.dialogView.selectDifficulty(chartIndex, song.audioFile !== null);
  }

  private playSelectedSong(): void {
    const song = this.selectedSong;
    const chart = this.selectedChart;

    if (!song || !chart || !song.audioFile) {
      return;
    }

    this.closeDialog();
    this.callbacks.onPlaySong(song, chart);
  }

  private async playPreview(song: SongEntry): Promise<void> {
    this.previewPlayer.stop();

    if (!song.audioFile) {
      this.dialogView.setPreviewStatus("Preview unavailable");
      return;
    }

    const declaredStart = song.simfile.sampleStartSeconds;
    const declaredLength = song.simfile.sampleLengthSeconds;
    const previewStartSeconds = declaredStart > 0 ? declaredStart : 20;
    const previewDurationSeconds = declaredLength > 0 ? Math.min(declaredLength, 15) : 12;

    try {
      await this.previewPlayer.play(song.audioFile, {
        startSeconds: previewStartSeconds,
        durationSeconds: previewDurationSeconds,
      });

      if (this.selectedSong?.id === song.id && this.dialogView.isOpen()) {
        this.dialogView.setPreviewStatus("♪ Preview playing");
      }
    } catch (error) {
      console.error("Could not play song preview:", error);

      if (this.selectedSong?.id === song.id) {
        this.dialogView.setPreviewStatus("Preview could not be played");
      }
    }
  }

  private formatBpmRange(bpmValues: readonly number[]): string {
    const validValues = bpmValues.filter((bpm) => Number.isFinite(bpm) && bpm > 0);

    if (validValues.length === 0) {
      return "BPM —";
    }

    const minimum = Math.min(...validValues);
    const maximum = Math.max(...validValues);

    if (Math.abs(maximum - minimum) < 0.001) {
      return `BPM ${minimum.toFixed(0)}`;
    }

    return `BPM ${minimum.toFixed(0)}–${maximum.toFixed(0)}`;
  }
}
