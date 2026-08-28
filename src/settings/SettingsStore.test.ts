import { describe, expect, it } from "vitest";
import { SettingsStore } from "./SettingsStore";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  public get length(): number { return this.values.size; }
  public clear(): void { this.values.clear(); }
  public getItem(key: string): string | null { return this.values.get(key) ?? null; }
  public key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  public removeItem(key: string): void { this.values.delete(key); }
  public setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("SettingsStore", () => {
  it("uses safe defaults when storage is empty", () => {
    const store = new SettingsStore(new MemoryStorage());
    expect(store.get().input.minimumFootConfidence).toBe(0.5);
    expect(store.get().gameplay.playfieldWidth).toBe(1180);
  });

  it("persists validated updates", () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage);
    store.update((settings) => ({
      ...settings,
      input: { ...settings.input, inferenceFps: 20 },
    }));
    expect(new SettingsStore(storage).get().input.inferenceFps).toBe(20);
  });

  it("migrates the legacy playfield width preference", () => {
    const storage = new MemoryStorage();
    storage.setItem("dance-vision.playfield-width", "900");
    expect(new SettingsStore(storage).get().gameplay.playfieldWidth).toBe(900);
  });
});
