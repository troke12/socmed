import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The route guards on a signed session cookie, which needs a request context
// that does not exist under vitest. Stubbing the guard keeps these tests aimed
// at the post-creation logic rather than at auth, which auth.test.ts covers.
vi.mock("@/lib/auth/require", () => ({
  requireSession: async () => ({ id: 1, username: "admin", role: "admin" }),
  requireRole: async () => ({ id: 1, username: "admin", role: "admin" }),
  trySession: async () => ({ id: 1, username: "admin", role: "admin" }),
}));

let dbDir: string;
let ORIGINAL_DB: string | undefined;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "socmed-posts-api-"));
  ORIGINAL_DB = process.env.SOCMED_DB_PATH;
  process.env.SOCMED_DB_PATH = join(dbDir, "test.db");
  process.env.SOCMED_MASTER_KEY = Buffer.alloc(32, 5).toString("base64");
  const { sqlite } = await import("@db/client");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const { runMigrations } = await import("@db/migrate");
  await runMigrations();
  await import("@/app/api/posts/route");
}, 120_000);

afterAll(() => {
  if (ORIGINAL_DB !== undefined) process.env.SOCMED_DB_PATH = ORIGINAL_DB;
  try {
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows can hold SQLite file locks briefly — best-effort cleanup.
  }
});

async function seedAccount(label: string, platform = "x"): Promise<number> {
  const { sqlite } = await import("@db/client");
  const now = Math.floor(Date.now() / 1000);
  const row = sqlite
    .prepare(
      `INSERT INTO accounts (platform, label, handle, encrypted_creds, creds_iv, creds_tag, webhook_secret, created_at)
       VALUES (?, ?, 'handle', ?, ?, ?, 'secret', ?) RETURNING id`,
    )
    .get(platform, label, Buffer.alloc(4), Buffer.alloc(12), Buffer.alloc(16), now) as { id: number };
  return row.id;
}

async function postJson(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/posts/route");
  const res = await POST(
    new Request("http://localhost/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/posts — cross-posting", () => {
  it("creates one row per target account", async () => {
    const { sqlite } = await import("@db/client");
    const a = await seedAccount("fanout-x", "x");
    const b = await seedAccount("fanout-li", "linkedin");
    const c = await seedAccount("fanout-md", "mastodon");

    const { status, json } = await postJson({
      accountIds: [a, b, c],
      kind: "text",
      caption: "same caption everywhere",
      hashtags: "#launch",
    });

    expect(status).toBe(201);
    const ids = json.ids as number[];
    expect(ids).toHaveLength(3);
    // `id` is kept for callers written against the single-target response.
    expect(json.id).toBe(ids[0]);

    const rows = sqlite
      .prepare(`SELECT account_id, caption FROM posts WHERE id IN (?, ?, ?) ORDER BY account_id`)
      .all(...ids) as { account_id: number; caption: string }[];
    expect(rows.map((r) => r.account_id)).toEqual([a, b, c].sort((x, y) => x - y));
    // One row each, not one shared row — per-account metrics depend on this.
    expect(new Set(rows.map((r) => r.caption)).size).toBe(1);
  });

  it("attaches the same media to every target, in order", async () => {
    const { sqlite } = await import("@db/client");
    const now = Math.floor(Date.now() / 1000);
    const mediaIds = [1, 2].map((n) => {
      const row = sqlite
        .prepare(
          `INSERT INTO media_assets (path, kind, mime, size_bytes, sha256, created_at)
           VALUES (?, 'image', 'image/png', 10, ?, ?) RETURNING id`,
        )
        .get(`m${n}-${now}.png`, `sha-${n}-${now}`, now) as { id: number };
      return row.id;
    });
    const a = await seedAccount("media-a");
    const b = await seedAccount("media-b");

    const { json } = await postJson({
      accountIds: [a, b],
      kind: "carousel",
      caption: "with media",
      mediaIds,
    });

    for (const postId of json.ids as number[]) {
      const links = sqlite
        .prepare(`SELECT media_id, position FROM post_media WHERE post_id = ? ORDER BY position`)
        .all(postId) as { media_id: number; position: number }[];
      expect(links.map((l) => l.media_id)).toEqual(mediaIds);
      expect(links.map((l) => l.position)).toEqual([0, 1]);
    }
  });

  it("queues one publish job per target when scheduled", async () => {
    const { sqlite } = await import("@db/client");
    const a = await seedAccount("sched-a");
    const b = await seedAccount("sched-b");
    const when = Math.floor(Date.now() / 1000) + 3600;

    const { json } = await postJson({
      accountIds: [a, b],
      kind: "text",
      caption: "later",
      scheduledFor: when,
    });

    expect(json.status).toBe("scheduled");
    for (const postId of json.ids as number[]) {
      const job = sqlite
        .prepare(`SELECT run_at FROM jobs WHERE kind = 'publish_post' AND payload = ?`)
        .get(JSON.stringify({ postId })) as { run_at: number } | undefined;
      expect(job?.run_at).toBe(when);
    }
  });

  it("creates nothing at all when one target does not exist", async () => {
    const { sqlite } = await import("@db/client");
    const a = await seedAccount("partial-a");
    const before = (sqlite.prepare(`SELECT COUNT(*) as n FROM posts`).get() as { n: number }).n;

    const { status, json } = await postJson({
      accountIds: [a, 999999],
      kind: "text",
      caption: "should not land",
    });

    expect(status).toBe(404);
    expect(json.error).toContain("999999");
    // A half-applied fan-out would publish to some platforms and silently drop
    // the rest, with no record of what was missed.
    const after = (sqlite.prepare(`SELECT COUNT(*) as n FROM posts`).get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("still accepts a single accountId", async () => {
    const a = await seedAccount("single-target");
    const { status, json } = await postJson({ accountId: a, kind: "text", caption: "one" });
    expect(status).toBe(201);
    expect(json.ids).toHaveLength(1);
  });

  it("collapses a duplicated account to one post", async () => {
    const a = await seedAccount("dupe-target");
    const { json } = await postJson({ accountIds: [a, a, a], kind: "text", caption: "once" });
    expect(json.ids).toHaveLength(1);
  });

  it("rejects a body with no target at all", async () => {
    const { status } = await postJson({ kind: "text", caption: "nowhere" });
    expect(status).toBe(400);
  });
});
