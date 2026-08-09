const OUTPUT_SAMPLE_RATE = 22_050;

export class AudioPreviewClipBuilder {
    public async build(file: File, startSeconds: number, durationSeconds: number): Promise<Blob> {
        const context = new AudioContext();
        try {
            const decoded = await context.decodeAudioData(await file.arrayBuffer());
            const startFrame = Math.min(decoded.length, Math.max(0, Math.floor(startSeconds * decoded.sampleRate)));
            const sourceFrames = Math.min(decoded.length - startFrame, Math.ceil(Math.min(15, durationSeconds) * decoded.sampleRate));
            const outputFrames = Math.max(1, Math.floor(sourceFrames * OUTPUT_SAMPLE_RATE / decoded.sampleRate));
            const mono = new Float32Array(outputFrames);
            for (let outputIndex = 0; outputIndex < outputFrames; outputIndex += 1) {
                const sourceIndex = startFrame + Math.min(sourceFrames - 1, Math.floor(outputIndex * decoded.sampleRate / OUTPUT_SAMPLE_RATE));
                let sample = 0;
                for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
                    sample += decoded.getChannelData(channel)[sourceIndex] ?? 0;
                }
                mono[outputIndex] = sample / decoded.numberOfChannels;
            }
            return new Blob([encodeMonoPcm16Wav(mono, OUTPUT_SAMPLE_RATE)], { type: "audio/wav" });
        } finally {
            await context.close();
        }
    }
}

export function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const text = (offset: number, value: string): void => {
        for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE");
    text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, index) => {
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    });
    return buffer;
}
