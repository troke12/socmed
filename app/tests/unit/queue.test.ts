import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dbDir: string;
let ORIGINAL_DB: string | undefined;
let ORIGINAL_UPLOADS: string | undefined;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "socmed-queue-"));
  ORIGINAL_DB = process.env.SOCMED_DB_PATH;
  ORIGINAL_UPLOADS = process.env.SOCMED_UPLOADS_DIR;
  process.env.SOCMED_DB_PATH = join(dbDir, "test.db");
  process.env.SOCMED_UPLOADS_DIR = join(dbDir, "uploads");
  // Force module to pick up env
  const { sqlite } = await import("@db/client");
  sqlite.exec("PRAGMA journal_mode = WAL");
  // Run migrations from the new test db
  const { runMigrations } = await import("@db/migrate");
  const result = await runMigrations();
  expect(result.applied.length).toBeGreaterThan(0);
});

afterAll(() => {
  if (ORIGINAL_DB !== undefined) process.env.SOCMED_DB_PATH = ORIGINAL_DB;
  if (ORIGINAL_UPLOADS !== undefined) process.env.SOCMED_UPLOADS_DIR = ORIGINAL_UPLOADS;
  rmSync(dbDir, { recursive: true, force: true });
});

describe("queue", () => {
  it("enqueues and claims a job in order", async () => {
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext, complete, queueStats } = await import("@/lib/queue/claim");

    const now = Math.floor(Date.now() / 1000);
    const a = enqueue("publish_post", { postId: 1 }, { runAt: now + 1 });
    const b = enqueue("publish_post", { postId: 2 }, { runAt: now + 2 });
    const c = enqueue("publish_post", { postId: 3 }, { runAt: now + 3 });

    // Nothing due yet
    expect(claimNext(now)).toBeNull();

    // Advance virtual clock: now+1.5
    const j = claimNext(now + 1);
    expect(j).not.toBeNull();
    expect(j?.id).toBe(a);
    complete(j!.id);

    const j2 = claimNext(now + 2);
    expect(j2?.id).toBe(b);
    complete(j2!.id);

    const j3 = claimNext(now + 3);
    expect(j3?.id).toBe(c);
    complete(j3!.id);

    const stats = queueStats();
    expect(stats.done).toBeGreaterThanOrEqual(3);
  });

  it("retries failed jobs with exponential backoff", async () => {
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext, fail, queueStats } = await import("@/lib/queue/claim");
    const { sqlite } = await import("@db/client");

    const id = enqueue("publish_post", { postId: 99 });
    const j1 = claimNext();
    expect(j1?.id).toBe(id);
    fail(j1!.id, "boom");

    // Job should be pending again, with run_at > now
    const row = sqlite.prepare("SELECT run_at, status, attempts FROM jobs WHERE id = ?").get(id) as
      | { run_at: number; status: string; attempts: number }
      | undefined;
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(1);
    expect(row!.run_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("marks job dead after max_attempts", async () => {
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext, fail } = await import("@/lib/queue/claim");
    const { sqlite } = await import("@db/client");

    const id = enqueue("publish_post", { postId: 1 }, { maxAttempts: 2 });
    // First attempt: fail → pending with attempts=1
    const j1 = claimNext()!;
    fail(j1.id, "first");
    // Force run_at to past so we can re-claim
    sqlite.prepare("UPDATE jobs SET run_at = 0 WHERE id = ?").run(id);
    // Second attempt: fail → dead
    const j2 = claimNext()!;
    fail(j2.id, "second");
    const row = sqlite.prepare("SELECT status, last_error FROM jobs WHERE id = ?").get(id) as
      | { status: string; last_error: string }
      | undefined;
    expect(row?.status).toBe("dead");
    expect(row?.last_error).toBe("second");
  });

  it("concurrent claim is atomic (only one worker wins)", async () => {
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext } = await import("@/lib/queue/claim");

    // Enqueue 5 jobs
    const ids = [] as number[];
    for (let i = 0; i < 5; i++) ids.push(enqueue("publish_post", { i }));

    // 10 concurrent claims — only 5 should succeed
    const results = await Promise.all(
      Array.from({ length: 10 }, () => Promise.resolve(claimNext())),
    );
    const wins = results.filter((r) => r !== null);
    expect(wins.length).toBe(5);
    const seen = new Set(wins.map((w) => w!.id));
    expect(seen.size).toBe(5); // each job claimed exactly once
  });
});
