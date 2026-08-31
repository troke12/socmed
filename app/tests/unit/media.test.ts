import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { probeImage } from "@/lib/media/probe";
import { storeBuffer } from "@/lib/media/storage";
import { rmSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("media probe", () => {
  it("probes an image (dimensions match)", async () => {
    const buf = await sharp({
      create: { width: 320, height: 200, channels: 3, background: { r: 100, g: 200, b: 50 } },
    })
      .png()
      .toBuffer();
    const probe = await probeImage(buf);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(200);
  });
});

describe("media storage", () => {
  it("stores a buffer and round-trips by sha256", async () => {
    const dir = mkdtempSync(join(tmpdir(), "socmed-store-"));
    const prev = process.env.SOCMED_UPLOADS_DIR;
    process.env.SOCMED_UPLOADS_DIR = dir;
    try {
      const buf = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer();
      const stored = await storeBuffer(buf, ".png", "image/png");
      expect(existsSync(stored.absolutePath)).toBe(true);
      expect(stored.sha256).toHaveLength(64);
      // Same bytes → same sha256
      const stored2 = await storeBuffer(buf, ".png", "image/png");
      expect(stored2.sha256).toBe(stored.sha256);
      expect(stored2.path).toBe(stored.path);
    } finally {
      if (prev !== undefined) process.env.SOCMED_UPLOADS_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
