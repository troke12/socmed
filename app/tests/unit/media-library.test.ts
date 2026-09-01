import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/lib/auth/require", () => ({
  requireSession: async () => ({ id: 1, username: "admin", role: "admin" }),
  requireRole: async () => ({ id: 1, username: "admin", role: "admin" }),
  trySession: async () => ({ id: 1, username: "admin", role: "admin" }),
}));

let dbDir: string;
let ORIGINAL_DB: string | undefined;
let imageA = 0;
let imageB = 0;
let videoA = 0;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "socmed-medialib-"));
  ORIGINAL_DB = process.env.SOCMED_DB_PATH;
  process.env.SOCMED_DB_PATH = join(dbDir, "test.db");
  const { sqlite } = await import("@db/client");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const { runMigrations } = await import("@db/migrate");
  await runMigrations();
  await import("@/app/api/media/library/route");

  const now = Math.floor(Date.now() / 1000);
  const insert = (path: string, kind: string, mime: string, alt: string | null, sha: string, created: number) =>
    (sqlite
      .prepare(
        `INSERT INTO media_assets (path, kind, mime, size_bytes, alt_text, sha256, created_at)
         VALUES (?, ?, ?, 1024, ?, ?, ?) RETURNING id`,
      )
      .get(path, kind, mime, alt, sha, created) as { id: number }).id;

  imageA = insert("ab/logo.png", "image", "image/png", "Company logo", "sha-a", now - 300);
  imageB = insert("cd/hero.jpg", "image", "image/jpeg", null, "sha-b", now - 200);
  videoA = insert("ef/promo.mp4", "video", "video/mp4", "Promo clip", "sha-c", now - 100);

  // imageA is attached to two posts; imageB to none.
  const acct = (sqlite
    .prepare(
      `INSERT INTO accounts (platform, label, handle, encrypted_creds, creds_iv, creds_tag, webhook_secret, created_at)
       VALUES ('x', 'lib', 'h', ?, ?, ?, 's', ?) RETURNING id`,
    )
    .get(Buffer.alloc(4), Buffer.alloc(12), Buffer.alloc(16), now) as { id: number }).id;
  for (const n of [1, 2]) {
    const post = (sqlite
      .prepare(
        `INSERT INTO posts (account_id, kind, status, caption, hashtags, created_at, updated_at)
         VALUES (?, 'image', 'draft', ?, '', ?, ?) RETURNING id`,
      )
      .get(acct, `post ${n}`, now, now) as { id: number }).id;
    sqlite.prepare(`INSERT INTO post_media (post_id, media_id, position) VALUES (?, ?, 0)`).run(post, imageA);
  }
}, 120_000);

afterAll(() => {
  if (ORIGINAL_DB !== undefined) process.env.SOCMED_DB_PATH = ORIGINAL_DB;
  try {
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows can hold SQLite file locks briefly — best-effort cleanup.
  }
});

async function list(query = ""): Promise<{ media: Record<string, unknown>[]; total: number }> {
  const { GET } = await import("@/app/api/media/library/route");
  const res = await GET(new Request(`http://localhost/api/media/library${query}`));
  return (await res.json()) as { media: Record<string, unknown>[]; total: number };
}

describe("GET /api/media/library", () => {
  it("returns every asset, newest first", async () => {
    const { media, total } = await list();
    expect(total).toBe(3);
    expect(media.map((m) => m.id)).toEqual([videoA, imageB, imageA]);
  });

  it("counts how many posts use each asset, including unused ones", async () => {
    const { media } = await list();
    const byId = Object.fromEntries(media.map((m) => [m.id, m.usageCount]));
    expect(byId[imageA]).toBe(2);
    // An unused asset must still appear — it is exactly what the library is for.
    expect(byId[imageB]).toBe(0);
    expect(byId[videoA]).toBe(0);
  });

  it("filters by kind", async () => {
    expect((await list("?kind=video")).media.map((m) => m.id)).toEqual([videoA]);
    expect((await list("?kind=image")).media.map((m) => m.id)).toEqual([imageB, imageA]);
  });

  it("searches alt text, filename and mime", async () => {
    expect((await list("?q=logo")).media.map((m) => m.id)).toEqual([imageA]);
    // hero.jpg has no alt text, so only the path can match it.
    expect((await list("?q=hero")).media.map((m) => m.id)).toEqual([imageB]);
    expect((await list("?q=video/mp4")).media.map((m) => m.id)).toEqual([videoA]);
  });

  it("combines search with the kind filter", async () => {
    expect((await list("?q=o&kind=video")).media.map((m) => m.id)).toEqual([videoA]);
  });

  it("reports the unfiltered total alongside a limited page", async () => {
    const page = await list("?limit=1");
    expect(page.media).toHaveLength(1);
    expect(page.total).toBe(3);
  });
});

describe("POST /api/media/library", () => {
  it("sets alt text on an existing asset", async () => {
    const { POST } = await import("@/app/api/media/library/route");
    const res = await POST(
      new Request("http://localhost/api/media/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_alt", id: imageB, altText: "Hero banner" }),
      }),
    );
    expect(res.status).toBe(200);
    // The new text must be searchable straight away.
    expect((await list("?q=Hero banner")).media.map((m) => m.id)).toEqual([imageB]);
  });

  it("404s on an unknown asset", async () => {
    const { POST } = await import("@/app/api/media/library/route");
    const res = await POST(
      new Request("http://localhost/api/media/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_alt", id: 999999, altText: "nope" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
