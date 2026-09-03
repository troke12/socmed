import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dayBucket } from "@/lib/queue/audience";
import { xFetchAudience } from "@platforms/x/client";
import { youtubeFetchAudience } from "@platforms/youtube/client";
import { mastodonFetchAudience } from "@platforms/mastodon/client";
import { blueskyFetchAudience } from "@platforms/bluesky/client";
import { facebookFetchAudience } from "@platforms/facebook/client";

const DAY = 24 * 60 * 60;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("dayBucket", () => {
  it("floors to midnight UTC", () => {
    const noon = Date.UTC(2026, 8, 1, 12, 34, 56) / 1000;
    expect(dayBucket(noon)).toBe(Date.UTC(2026, 8, 1) / 1000);
  });

  it("gives the same bucket for any time on the same day", () => {
    const day = Date.UTC(2026, 8, 1) / 1000;
    // The unique index is on (account_id, captured_at), so two polls on one day
    // must collide rather than producing two points.
    expect(dayBucket(day + 1)).toBe(dayBucket(day + DAY - 1));
  });

  it("advances at the boundary", () => {
    const day = Date.UTC(2026, 8, 1) / 1000;
    expect(dayBucket(day + DAY)).toBe(day + DAY);
  });
});

describe("audience field mapping", () => {
  afterAll(() => { vi.restoreAllMocks(); });

  it("reads X public_metrics, including post_count rather than tweet_count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ data: { public_metrics: { followers_count: 1200, following_count: 300, post_count: 87 } } }),
    ));
    // tweet_count is the name from the older API; reading it would silently
    // yield undefined.
    expect(await xFetchAudience("tok")).toMatchObject({ followers: 1200, following: 300, posts: 87 });
  });

  it("coerces YouTube's string statistics to numbers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ items: [{ statistics: { subscriberCount: "5400", videoCount: "42", viewCount: "99" } }] }),
    ));
    const r = await youtubeFetchAudience("tok");
    // The API returns these as strings; leaving them would break arithmetic.
    expect(r.followers).toBe(5400);
    expect(r.posts).toBe(42);
    expect(typeof r.followers).toBe("number");
  });

  it("reads Mastodon's snake_case account counts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ followers_count: 88, following_count: 12, statuses_count: 401 }),
    ));
    expect(await mastodonFetchAudience("https://mastodon.example", "tok")).toMatchObject({
      followers: 88, following: 12, posts: 401,
    });
  });

  it("reads Bluesky's camelCase profile counts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ followersCount: 7, followsCount: 9, postsCount: 3 }),
    ));
    // atproto uses camelCase here, unlike most of its neighbours.
    expect(await blueskyFetchAudience("https://bsky.social", "jwt", "did:plc:x")).toMatchObject({
      followers: 7, following: 9, posts: 3,
    });
  });

  it("prefers followers_count over the legacy fan_count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ followers_count: 500, fan_count: 480 })));
    expect((await facebookFetchAudience("page1", "tok")).followers).toBe(500);
  });

  it("falls back to fan_count when followers_count is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ fan_count: 480 })));
    expect((await facebookFetchAudience("page1", "tok")).followers).toBe(480);
  });

  it("leaves a metric undefined rather than zero when unreported", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: { public_metrics: { followers_count: 10 } } })));
    const r = await xFetchAudience("tok");
    // Storing 0 for "not reported" would draw a cliff that never happened.
    expect(r.followers).toBe(10);
    expect(r.following).toBeUndefined();
    expect(r.posts).toBeUndefined();
  });

  it("raises on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    await expect(xFetchAudience("tok")).rejects.toThrow(/X audience: 401/);
  });
});

describe("snapshot persistence", () => {
  let dbDir: string;
  let ORIGINAL_DB: string | undefined;

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), "socmed-audience-"));
    ORIGINAL_DB = process.env.SOCMED_DB_PATH;
    process.env.SOCMED_DB_PATH = join(dbDir, "test.db");
    process.env.SOCMED_MASTER_KEY = Buffer.alloc(32, 6).toString("base64");
    const { sqlite } = await import("@db/client");
    sqlite.exec("PRAGMA journal_mode = WAL");
    const { runMigrations } = await import("@db/migrate");
    await runMigrations();
    await import("@/lib/queue/audience");
  }, 120_000);

  afterAll(() => {
    if (ORIGINAL_DB !== undefined) process.env.SOCMED_DB_PATH = ORIGINAL_DB;
    try {
      rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows can hold SQLite file locks briefly — best-effort cleanup.
    }
  });

  async function seedAccount(platform: string, label: string): Promise<number> {
    const { sqlite } = await import("@db/client");
    const now = Math.floor(Date.now() / 1000);
    return (sqlite
      .prepare(
        `INSERT INTO accounts (platform, label, handle, encrypted_creds, creds_iv, creds_tag, webhook_secret, created_at)
         VALUES (?, ?, 'h', ?, ?, ?, 's', ?) RETURNING id`,
      )
      .get(platform, label, Buffer.alloc(4), Buffer.alloc(12), Buffer.alloc(16), now) as { id: number }).id;
  }

  it("keeps one row per account per day and corrects it on re-run", async () => {
    const { sqlite } = await import("@db/client");
    const accountId = await seedAccount("x", `dedupe-${Math.random()}`);
    const day = dayBucket();

    const upsert = (followers: number) =>
      sqlite
        .prepare(
          `INSERT INTO audience_snapshots (account_id, platform, captured_at, followers)
           VALUES (?, 'x', ?, ?)
           ON CONFLICT(account_id, captured_at) DO UPDATE SET followers = excluded.followers`,
        )
        .run(accountId, day, followers);

    upsert(100);
    upsert(105);

    const rows = sqlite
      .prepare(`SELECT followers FROM audience_snapshots WHERE account_id = ?`)
      .all(accountId) as { followers: number }[];
    // A second poll the same day corrects the figure rather than adding a point.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.followers).toBe(105);
  });

  it("skips accounts whose adapter cannot report an audience", async () => {
    const { enqueueDueAudienceSnapshots } = await import("@/lib/queue/audience");
    const { sqlite } = await import("@db/client");
    const supported = await seedAccount("mastodon", `sup-${Math.random()}`);
    const unsupported = await seedAccount("pinterest", `unsup-${Math.random()}`);

    enqueueDueAudienceSnapshots();

    const jobFor = (id: number) =>
      sqlite
        .prepare(`SELECT COUNT(*) as n FROM jobs WHERE kind = 'fetch_audience' AND payload = ?`)
        .get(JSON.stringify({ accountId: id })) as { n: number };
    expect(jobFor(supported).n).toBe(1);
    // Enqueueing for a platform with no endpoint would put a job on the queue
    // purely to complete as a no-op.
    expect(jobFor(unsupported).n).toBe(0);
  });

  it("does not re-enqueue while a job for today is already in flight", async () => {
    const { enqueueDueAudienceSnapshots } = await import("@/lib/queue/audience");
    const before = enqueueDueAudienceSnapshots();
    expect(enqueueDueAudienceSnapshots()).toBe(0);
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it("does not enqueue again once today's row exists", async () => {
    const { enqueueDueAudienceSnapshots } = await import("@/lib/queue/audience");
    const { sqlite } = await import("@db/client");
    const accountId = await seedAccount("bluesky", `done-${Math.random()}`);
    sqlite
      .prepare(`INSERT INTO audience_snapshots (account_id, platform, captured_at, followers) VALUES (?, 'bluesky', ?, 5)`)
      .run(accountId, dayBucket());
    sqlite.prepare(`DELETE FROM jobs WHERE kind = 'fetch_audience'`).run();

    enqueueDueAudienceSnapshots();
    const n = sqlite
      .prepare(`SELECT COUNT(*) as n FROM jobs WHERE kind = 'fetch_audience' AND payload = ?`)
      .get(JSON.stringify({ accountId })) as { n: number };
    expect(n.n).toBe(0);
  });
});
