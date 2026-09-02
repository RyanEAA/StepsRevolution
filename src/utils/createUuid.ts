/**
 * Create a UUID for client-side protocol identifiers.
 *
 * `crypto.randomUUID()` is only exposed by some browsers in secure contexts.
 * During local-network development (for example http://192.168.x.x:5173),
 * `crypto.getRandomValues()` can still be available even when randomUUID is not.
 */
export function createUuid(): string {
    const cryptoApi = globalThis.crypto;

    if (typeof cryptoApi?.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }

    if (typeof cryptoApi?.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);

        // RFC 4122 version 4 + variant bits.
        bytes[6] = (bytes[6]! & 0x0f) | 0x40;
        bytes[8] = (bytes[8]! & 0x3f) | 0x80;

        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
        return [
            hex.slice(0, 4).join(""),
            hex.slice(4, 6).join(""),
            hex.slice(6, 8).join(""),
            hex.slice(8, 10).join(""),
            hex.slice(10, 16).join(""),
        ].join("-");
    }

    // Very old/nonstandard environments: uniqueness is sufficient for these
    // transient client protocol IDs; they are not authentication secrets.
    const timestamp = Date.now().toString(16).padStart(12, "0");
    const random = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
        .toString(16)
        .padStart(14, "0")
        .slice(-14);
    return `${timestamp.slice(0, 8)}-${timestamp.slice(8, 12)}-4${random.slice(0, 3)}-8${random.slice(3, 6)}-${random.slice(6, 18).padEnd(12, "0")}`;
}
