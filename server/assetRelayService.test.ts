import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    AssetRelayError,
    AssetRelayService,
} from "./assetRelayService";

const roots: string[] = [];

afterEach(async () => {
    for (const root of roots.splice(0)) {
        await rm(root, { recursive: true, force: true });
    }
});

describe("AssetRelayService lifecycle", () => {
    it("expires reservations and removes their room ownership", async () => {
        let nowMs = 1_000;
        const rootDirectory = await mkdtemp(
            join(tmpdir(), "dance-vision-relay-lifecycle-"),
        );
        roots.push(rootDirectory);
        const relay = new AssetRelayService({
            rootDirectory,
            now: () => nowMs,
            assetTtlMs: 100,
            createAssetId: () => "asset_1234567890123456",
            createTicket: () => "t".repeat(64),
        });
        await relay.start();
        const grant = relay.reserveUpload("room-1", "host-1", {
            kind: "artwork",
            mimeType: "image/png",
            byteLength: 4,
            sha256: `sha256:${"a".repeat(64)}`,
        });

        expect(() => relay.grantDownload(
            "room-1",
            "host-1",
            grant.asset.assetId,
        )).toThrowError(AssetRelayError);

        nowMs += 101;
        await relay.cleanupExpired();
        try {
            relay.grantDownload(
                "room-1",
                "host-1",
                grant.asset.assetId,
            );
            throw new Error("Expected the expired asset to be rejected.");
        } catch (error) {
            expect(error).toMatchObject({ code: "asset-not-found" });
        }
    });
});
