import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SUPPORTS_COMMENT_REPLY,
  SUPPORTS_TOP_LEVEL_COMMENT,
  supportsFirstComment,
} from "@platforms/capabilities";
import { NotImplementedError } from "@platforms/types";
import type { Platform } from "@db/schema";

let dbDir: string;
let ORIGINAL_DB: string | undefined;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "socmed-firstcomment-"));
  ORIGINAL_DB = process.env.SOCMED_DB_PATH;
  process.env.SOCMED_DB_PATH = join(dbDir, "test.db");
  process.env.SOCMED_MASTER_KEY = Buffer.alloc(32, 4).toString("base64");
  const { sqlite } = await import("@db/client");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const { runMigrations } = await import("@db/migrate");
  await runMigrations();
  await import("@/lib/queue/handlers");
}, 120_000);

afterAll(() => {
  if (ORIGINAL_DB !== undefined) process.env.SOCMED_DB_PATH = ORIGINAL_DB;
  try {
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows can hold SQLite file locks briefly — best-effort cleanup.
  }
});

describe("comment-reply capability map", () => {
  it("covers every platform in the accounts enum", async () => {
    const { accounts } = await import("@db/schema");
    // Drift guard: a 13th platform must make a conscious choice in both maps
    // rather than defaulting to undefined and reading as unsupported by accident.
    const enumValues = (accounts.platform as unknown as { enumValues: readonly Platform[] }).enumValues;
    for (const p of enumValues) {
      expect(SUPPORTS_COMMENT_REPLY[p], `${p} missing from SUPPORTS_COMMENT_REPLY`).toBeTypeOf("boolean");
      expect(SUPPORTS_TOP_LEVEL_COMMENT[p], `${p} missing from SUPPORTS_TOP_LEVEL_COMMENT`).toBeTypeOf("boolean");
    }
  });

  it("exposes postComment exactly where the top-level map says it can", async () => {
    await import("@platforms/bootstrap");
    const { getAdapter } = await import("@platforms/registry");
    for (const [platform, supported] of Object.entries(SUPPORTS_TOP_LEVEL_COMMENT) as [Platform, boolean][]) {
      const hasMethod = typeof getAdapter(platform).postComment === "function";
      // The map drives the UI hint and the handler's terminal path, so a map
      // entry with no method behind it would promise something that cannot run.
      expect(hasMethod, `${platform}: map says ${supported} but postComment ${hasMethod ? "exists" : "is missing"}`).toBe(supported);
    }
  });

  it("makes every unsupported adapter throw instead of faking success", async () => {
    await import("@platforms/bootstrap");
    const { getAdapter } = await import("@platforms/registry");
    const unsupported = (Object.keys(SUPPORTS_COMMENT_REPLY) as Platform[]).filter(
      (p) => !SUPPORTS_COMMENT_REPLY[p],
    );
    expect(unsupported.length).toBeGreaterThan(0);

    for (const platform of unsupported) {
      const adapter = getAdapter(platform);
      // A stub returning { platformCommentId: "" } marks replies as sent that
      // were never delivered — the regression this guards against (#32).
      await expect(
        adapter.postCommentReply("id", "text", "token", {} as never),
        `${platform} should reject`,
      ).rejects.toThrow();
    }
  });

  it("now reports x, instagram and linkedin as able to reply", () => {
    // These three returned a fake success before; only TikTok genuinely has no
    // endpoint for it.
    for (const p of ["x", "instagram", "linkedin"] as Platform[]) {
      expect(SUPPORTS_COMMENT_REPLY[p]).toBe(true);
    }
    expect(SUPPORTS_COMMENT_REPLY.tiktok).toBe(false);
  });

  it("separates top-level comment support from reply support", () => {
    // Discord can reply but cannot open a top-level comment: publishPost stores
    // a bare message id and the channel id is also needed.
    expect(SUPPORTS_COMMENT_REPLY.discord).toBe(true);
    expect(supportsFirstComment("discord")).toBe(false);
    for (const p of ["x", "instagram", "linkedin", "reddit", "mastodon", "facebook", "youtube"] as Platform[]) {
      expect(supportsFirstComment(p)).toBe(true);
    }
  });

  it("throws NotImplementedError specifically", async () => {
    await import("@platforms/bootstrap");
    const { getAdapter } = await import("@platforms/registry");
    await expect(getAdapter("tiktok").postCommentReply("id", "t", "tok", {} as never)).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});

describe("handleFirstComment", () => {
  async function seed(opts: {
    platform: Platform;
    firstComment: string | null;
    platformPostId: string | null;
    postedAt?: number | null;
  }): Promise<number> {
    const { sqlite } = await import("@db/client");
    const now = Math.floor(Date.now() / 1000);
    const accountId = (sqlite
      .prepare(
        `INSERT INTO accounts (platform, label, handle, encrypted_creds, creds_iv, creds_tag, webhook_secret, created_at)
         VALUES (?, ?, 'h', ?, ?, ?, 's', ?) RETURNING id`,
      )
      .get(opts.platform, `fc-${opts.platform}-${now}-${Math.random()}`, Buffer.alloc(4), Buffer.alloc(12), Buffer.alloc(16), now) as { id: number }).id;
    return (sqlite
      .prepare(
        `INSERT INTO posts (account_id, kind, status, caption, hashtags, first_comment, first_comment_posted_at, platform_post_id, created_at, updated_at)
         VALUES (?, 'text', 'published', 'body', '', ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(accountId, opts.firstComment, opts.postedAt ?? null, opts.platformPostId, now, now) as { id: number }).id;
  }

  async function run(postId: number): Promise<{ status: string; error: string | null; postedAt: number | null }> {
    const { sqlite } = await import("@db/client");
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext } = await import("@/lib/queue/claim");
    const { handleJob } = await import("@/lib/queue/handlers");
    const jobId = enqueue("first_comment", { postId });
    claimNext(Math.floor(Date.now() / 1000) + 1);
    await handleJob("first_comment", { postId }, jobId);
    const job = sqlite.prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId) as { status: string };
    const post = sqlite
      .prepare(`SELECT error, first_comment_posted_at AS postedAt FROM posts WHERE id = ?`)
      .get(postId) as { error: string | null; postedAt: number | null };
    return { status: job.status, error: post.error, postedAt: post.postedAt };
  }

  it("closes out without retrying on a platform that cannot post comments", async () => {
    const postId = await seed({ platform: "tiktok", firstComment: "#tags", platformPostId: "tt_1" });
    const r = await run(postId);
    // Retrying cannot give TikTok an endpoint it does not have, so burning five
    // backoff cycles would be pure waste.
    expect(r.status).toBe("done");
    expect(r.error).toContain("not supported on tiktok");
    expect(r.postedAt).toBeNull();
  });

  it("closes out on a platform that can reply but not open a thread", async () => {
    const postId = await seed({ platform: "discord", firstComment: "#tags", platformPostId: "msg_1" });
    const r = await run(postId);
    expect(r.status).toBe("done");
    expect(r.error).toContain("not supported on discord");
  });

  it("does nothing when the post has no first comment", async () => {
    const postId = await seed({ platform: "mastodon", firstComment: null, platformPostId: "m_1" });
    expect((await run(postId)).status).toBe("done");
  });

  it("does not post twice if the comment already landed", async () => {
    const already = Math.floor(Date.now() / 1000) - 60;
    const postId = await seed({
      platform: "mastodon",
      firstComment: "#tags",
      platformPostId: "m_2",
      postedAt: already,
    });
    const r = await run(postId);
    expect(r.status).toBe("done");
    // Unchanged: a retry after an unrelated failure must not duplicate it.
    expect(r.postedAt).toBe(already);
  });

  it("retries when the post has no platform id yet", async () => {
    const postId = await seed({ platform: "mastodon", firstComment: "#tags", platformPostId: null });
    const r = await run(postId);
    // Transient by nature — the publish may still be settling.
    expect(r.status).toBe("pending");
  });
});
