import {
  DEFAULT_SETTINGS,
  DanceVisionSettingsSchema,
  type DanceVisionSettings,
} from "./SettingsSchema";

const SETTINGS_STORAGE_KEY = "dance-vision.settings";
const LEGACY_PLAYFIELD_WIDTH_KEY = "dance-vision.playfield-width";
const LEGACY_DEBUG_VISIBLE_KEY = "dance-vision.debug-visible";

export type SettingsListener = (
  settings: Readonly<DanceVisionSettings>,
) => void;

export class SettingsStore {
  private settings: DanceVisionSettings;
  private readonly listeners = new Set<SettingsListener>();
  private readonly storage: Storage;

  public constructor(storage: Storage = localStorage) {
    this.storage = storage;
    this.settings = this.load();
  }

  public get(): Readonly<DanceVisionSettings> {
    return this.settings;
  }

  public update(
    updater: (current: DanceVisionSettings) => DanceVisionSettings,
  ): void {
    const candidate = updater(this.clone(this.settings));
    const result = DanceVisionSettingsSchema.safeParse(candidate);

    if (!result.success) {
      console.warn("Ignored invalid Visince settings update.", result.error);
      return;
    }

    this.settings = result.data;
    this.persist();
    this.emit();
  }

  public reset(): void {
    this.settings = this.clone(DEFAULT_SETTINGS);
    this.persist();
    this.emit();
  }

  public subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    listener(this.settings);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private load(): DanceVisionSettings {
    const raw = this.storage.getItem(SETTINGS_STORAGE_KEY);

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const result = DanceVisionSettingsSchema.safeParse(parsed);
        if (result.success) {
          return result.data;
        }
      } catch (error) {
        console.warn("Could not parse stored Visince settings.", error);
      }
    }

    const migrated = this.clone(DEFAULT_SETTINGS);
    const legacyWidth = Number.parseInt(
      this.storage.getItem(LEGACY_PLAYFIELD_WIDTH_KEY) ?? "",
      10,
    );
    if (Number.isFinite(legacyWidth)) {
      migrated.gameplay.playfieldWidth = Math.min(
        Math.max(legacyWidth, 400),
        1180,
      );
    }

    const legacyDebug = this.storage.getItem(LEGACY_DEBUG_VISIBLE_KEY);
    if (legacyDebug !== null) {
      migrated.interface.showDiagnostics = legacyDebug === "true";
    }

    return migrated;
  }

  private clone(settings: DanceVisionSettings): DanceVisionSettings {
    return {
      ...settings,
      input: { ...settings.input },
      gameplay: { ...settings.gameplay },
      interface: { ...settings.interface },
    };
  }

  private persist(): void {
    try {
      this.storage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(this.settings),
      );
    } catch (error) {
      console.warn("Could not save Visince settings.", error);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.settings);
    }
  }
}
