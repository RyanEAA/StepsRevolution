import { describe, expect, it } from "vitest";
import { encodeMonoPcm16Wav } from "./AudioPreviewClipBuilder";

describe("preview WAV encoding", () => {
    it("writes a mono PCM16 WAV with clamped samples", () => {
        const buffer = encodeMonoPcm16Wav(new Float32Array([-2, 0, 2]), 22_050);
        const view = new DataView(buffer);
        const text = (offset: number, length: number) =>
            String.fromCharCode(...new Uint8Array(buffer, offset, length));
        expect(text(0, 4)).toBe("RIFF");
        expect(text(8, 4)).toBe("WAVE");
        expect(view.getUint16(22, true)).toBe(1);
        expect(view.getUint32(24, true)).toBe(22_050);
        expect(view.getUint32(40, true)).toBe(6);
        expect(view.getInt16(44, true)).toBe(-32_768);
        expect(view.getInt16(48, true)).toBe(32_767);
    });
});
