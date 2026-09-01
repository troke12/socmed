import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Role } from "@/lib/auth/roles";

let actor: { id: number; username: string; role: Role } = { id: 1, username: "boss", role: "admin" };

vi.mock("@/lib/auth/require", async () => {
  const { atLeast } = await import("@/lib/auth/roles");
  const session = async () => actor;
  return {
    requireSession: session,
    trySession: session,
    requireRole: async (min: Role) => {
      if (!atLeast(actor.role, min)) {
        const err = new Error(`requires ${min} role or higher`) as Error & { status: number };
        err.status = 403;
        throw err;
      }
      return actor;
    },
  };
});

let dbDir: string;
let ORIGINAL_DB: string | undefined;
let ORIGINAL_APPROVAL: string | undefined;
let accountId = 0;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "socmed-review-"));
  ORIGINAL_DB = process.env.SOCMED_DB_PATH;
  ORIGINAL_APPROVAL = process.env.SOCMED_REQUIRE_APPROVAL;
  process.env.SOCMED_DB_PATH = join(dbDir, "test.db");
  const { sqlite } = await import("@db/client");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const { runMigrations } = await import("@db/migrate");
  await runMigrations();
  await import("@/app/api/posts/route");

  const now = Math.floor(Date.now() / 1000);
  sqlite.prepare(`INSERT INTO users (id, username, password_hash, role, created_at) VALUES (1, 'boss', 'x', 'admin', ?)`).run(now);
  sqlite.prepare(`INSERT INTO users (id, username, password_hash, role, created_at) VALUES (2, 'ed', 'x', 'editor', ?)`).run(now);
  accountId = (sqlite
    .prepare(
      `INSERT INTO accounts (platform, label, handle, encrypted_creds, creds_iv, creds_tag, webhook_secret, created_at)
       VALUES ('x', 'review', 'h', ?, ?, ?, 's', ?) RETURNING id`,
    )
    .get(Buffer.alloc(4), Buffer.alloc(12), Buffer.alloc(16), now) as { id: number }).id;
}, 120_000);

afterAll(() => {
  if (ORIGINAL_DB !== undefined) process.env.SOCMED_DB_PATH = ORIGINAL_DB;
  if (ORIGINAL_APPROVAL === undefined) delete process.env.SOCMED_REQUIRE_APPROVAL;
  else process.env.SOCMED_REQUIRE_APPROVAL = ORIGINAL_APPROVAL;
  try {
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows can hold SQLite file locks briefly — best-effort cleanup.
  }
});

const asEditor = () => { actor = { id: 2, username: "ed", role: "editor" }; };
const asAdmin = () => { actor = { id: 1, username: "boss", role: "admin" }; };

beforeEach(() => { asAdmin(); });

async function call(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
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

async function row(id: number) {
  const { sqlite } = await import("@db/client");
  return sqlite
    .prepare(`SELECT status, review_status, review_note, author_id, reviewer_id, scheduled_for FROM posts WHERE id = ?`)
    .get(id) as {
      status: string; review_status: string; review_note: string | null;
      author_id: number | null; reviewer_id: number | null; scheduled_for: number | null;
    };
}

async function pendingJobs(id: number): Promise<number> {
  const { sqlite } = await import("@db/client");
  return (sqlite
    .prepare(`SELECT COUNT(*) as n FROM jobs WHERE kind = 'publish_post' AND status = 'pending' AND payload = ?`)
    .get(JSON.stringify({ postId: id })) as { n: number }).n;
}

describe("approval off (default)", () => {
  it("lets an editor schedule directly", async () => {
    delete process.env.SOCMED_REQUIRE_APPROVAL;
    asEditor();
    const when = Math.floor(Date.now() / 1000) + 3600;
    const { json } = await call({ accountId, kind: "text", caption: "free to post", scheduledFor: when });
    const id = (json.ids as number[])[0]!;
    // Existing installs must keep behaving exactly as before.
    expect((await row(id)).status).toBe("scheduled");
    expect((await row(id)).review_status).toBe("none");
    expect(await pendingJobs(id)).toBe(1);
  });
});

describe("approval on", () => {
  beforeEach(() => { process.env.SOCMED_REQUIRE_APPROVAL = "true"; });

  it("holds an editor's scheduled post in review instead of queueing it", async () => {
    asEditor();
    const when = Math.floor(Date.now() / 1000) + 3600;
    const { json } = await call({ accountId, kind: "text", caption: "needs a look", scheduledFor: when });
    const id = (json.ids as number[])[0]!;
    const r = await row(id);
    expect(r.status).toBe("draft");
    expect(r.review_status).toBe("pending");
    expect(r.author_id).toBe(2);
    // The requested time is kept so approving can honour it.
    expect(r.scheduled_for).toBe(when);
    expect(await pendingJobs(id)).toBe(0);
  });

  it("blocks an editor from publishing an unapproved post", async () => {
    asEditor();
    const { json } = await call({ accountId, kind: "text", caption: "sneaky" });
    const id = (json.ids as number[])[0]!;
    const res = await call({ action: "publish_now", id });
    expect(res.status).toBe(403);
    expect(await pendingJobs(id)).toBe(0);
  });

  it("still lets an admin publish directly", async () => {
    const { json } = await call({ accountId, kind: "text", caption: "boss post" });
    const id = (json.ids as number[])[0]!;
    expect((await call({ action: "publish_now", id })).status).toBe(200);
    expect(await pendingJobs(id)).toBe(1);
  });

  it("approves and queues at the author's requested time", async () => {
    asEditor();
    const when = Math.floor(Date.now() / 1000) + 7200;
    const { json } = await call({ accountId, kind: "text", caption: "please approve", scheduledFor: when });
    const id = (json.ids as number[])[0]!;

    asAdmin();
    expect((await call({ action: "approve", id })).status).toBe(200);
    const r = await row(id);
    expect(r.review_status).toBe("approved");
    expect(r.status).toBe("scheduled");
    expect(r.reviewer_id).toBe(1);
    expect(r.scheduled_for).toBe(when);
    expect(await pendingJobs(id)).toBe(1);
  });

  it("publishes immediately when the requested time has already passed", async () => {
    const { sqlite } = await import("@db/client");
    asEditor();
    const { json } = await call({ accountId, kind: "text", caption: "stale schedule" });
    const id = (json.ids as number[])[0]!;
    const past = Math.floor(Date.now() / 1000) - 3600;
    sqlite.prepare(`UPDATE posts SET scheduled_for = ?, review_status = 'pending' WHERE id = ?`).run(past, id);

    asAdmin();
    await call({ action: "approve", id });
    // Queueing it in the past would mean it never fires visibly late — it fires now.
    expect((await row(id)).scheduled_for).toBeGreaterThan(past);
    expect(await pendingJobs(id)).toBe(1);
  });

  it("sends a rejected post back to draft with the note and no queued job", async () => {
    asEditor();
    const when = Math.floor(Date.now() / 1000) + 3600;
    const { json } = await call({ accountId, kind: "text", caption: "not great", scheduledFor: when });
    const id = (json.ids as number[])[0]!;

    asAdmin();
    expect((await call({ action: "reject", id, note: "tone is off" })).status).toBe(200);
    const r = await row(id);
    expect(r.review_status).toBe("rejected");
    expect(r.status).toBe("draft");
    expect(r.review_note).toBe("tone is off");
    expect(await pendingJobs(id)).toBe(0);
  });

  it("clears the old rejection when the author resubmits", async () => {
    asEditor();
    const { json } = await call({ accountId, kind: "text", caption: "v1" });
    const id = (json.ids as number[])[0]!;
    asAdmin();
    await call({ action: "reject", id, note: "fix the link" });

    asEditor();
    expect((await call({ action: "submit_review", id })).status).toBe(200);
    const r = await row(id);
    expect(r.review_status).toBe("pending");
    // A stale rejection note on a fresh submission would mislead the reviewer.
    expect(r.review_note).toBeNull();
    expect(r.reviewer_id).toBeNull();
  });

  it("revokes approval when an editor edits the content afterwards", async () => {
    asEditor();
    const { json } = await call({ accountId, kind: "text", caption: "harmless draft" });
    const id = (json.ids as number[])[0]!;
    await call({ action: "submit_review", id });
    asAdmin();
    await call({ action: "approve", id });
    expect((await row(id)).review_status).toBe("approved");

    asEditor();
    await call({ action: "update", id, caption: "something else entirely" });
    // Otherwise an editor could get a bland post approved and then rewrite it.
    expect((await row(id)).review_status).toBe("pending");
  });

  it("refuses approve/reject from a non-admin", async () => {
    asEditor();
    const { json } = await call({ accountId, kind: "text", caption: "self approve?" });
    const id = (json.ids as number[])[0]!;
    await call({ action: "submit_review", id });
    expect((await call({ action: "approve", id })).status).toBe(403);
    expect((await call({ action: "reject", id })).status).toBe(403);
  });

  it("refuses to approve a post that was never submitted", async () => {
    const { json } = await call({ accountId, kind: "text", caption: "unsubmitted" });
    const id = (json.ids as number[])[0]!;
    expect((await call({ action: "approve", id })).status).toBe(409);
  });
});
