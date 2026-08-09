import type { RoomPreview } from "../../shared/schemas";

export class RoomPreviewView {
    private readonly dialog = this.require<HTMLDialogElement>("#room-preview-dialog");
    private readonly title = this.require<HTMLElement>("#room-preview-title");
    private readonly artist = this.require<HTMLElement>("#room-preview-artist");
    private readonly status = this.require<HTMLElement>("#room-preview-status");
    private readonly artwork = this.require<HTMLImageElement>("#room-preview-artwork");
    private readonly audio = this.require<HTMLAudioElement>("#room-preview-audio");
    private readonly playButton = this.require<HTMLButtonElement>("#room-preview-play");
    private readonly closeButton = this.require<HTMLButtonElement>("#room-preview-close");

    public initialize(): void {
        this.playButton.addEventListener("click", this.play);
        this.closeButton.addEventListener("click", this.dismiss);
        this.dialog.addEventListener("close", this.stop);
    }

    public show(preview: RoomPreview): void {
        this.title.textContent = preview.subtitle ? `${preview.title} — ${preview.subtitle}` : preview.title;
        this.artist.textContent = preview.artist;
        this.status.textContent = "Loading shared preview…";
        this.playButton.hidden = true;
        if (!this.dialog.open) this.dialog.showModal();
    }

    public setArtwork(url: string | null): void {
        this.artwork.hidden = !url;
        if (url) this.artwork.src = url;
        else this.artwork.removeAttribute("src");
    }

    public async setAudio(url: string | null): Promise<void> {
        this.stop();
        if (!url) {
            this.status.textContent = "Audio preview unavailable";
            return;
        }
        this.audio.src = url;
        try {
            await this.audio.play();
            this.status.textContent = "♪ Shared preview playing";
        } catch {
            this.status.textContent = "Preview ready — press Play to listen";
            this.playButton.hidden = false;
        }
    }

    public showError(message: string): void { this.status.textContent = message; }
    public close(): void { if (this.dialog.open) this.dialog.close(); else this.stop(); }
    public destroy(): void {
        this.close();
        this.playButton.removeEventListener("click", this.play);
        this.closeButton.removeEventListener("click", this.dismiss);
        this.dialog.removeEventListener("close", this.stop);
    }

    private readonly play = (): void => { void this.audio.play().then(() => {
        this.status.textContent = "♪ Shared preview playing";
        this.playButton.hidden = true;
    }).catch(() => this.showError("Your browser blocked preview playback.")); };
    private readonly dismiss = (): void => this.close();
    private readonly stop = (): void => { this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load(); };
    private require<T extends Element>(selector: string): T {
        const element = document.querySelector<T>(selector);
        if (!element) throw new Error(`Required preview element was not found: ${selector}`);
        return element;
    }
}
