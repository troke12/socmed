import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dbDir: string;
let ORIGINAL_DB: string | undefined;
let ORIGINAL_UPLOADS: string | undefined;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "socmed-handlers-"));
  ORIGINAL_DB = process.env.SOCMED_DB_PATH;
  ORIGINAL_UPLOADS = process.env.SOCMED_UPLOADS_DIR;
  process.env.SOCMED_DB_PATH = join(dbDir, "test.db");
  process.env.SOCMED_UPLOADS_DIR = join(dbDir, "uploads");
  process.env.SOCMED_MASTER_KEY = Buffer.alloc(32, 3).toString("base64");
  const { sqlite } = await import("@db/client");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const { runMigrations } = await import("@db/migrate");
  await runMigrations();
  // Warm the module graph here rather than inside the first test. Importing
  // handlers pulls in platforms/bootstrap, which loads all 12 adapters, and on a
  // cold cache that alone can outlast a single test's timeout — leaving whichever
  // test happens to run first to fail for reasons that have nothing to do with it.
  await import("@/lib/queue/handlers");
  await import("@/lib/queue/tokens");
  await import("@/lib/schedule/rules");
}, 120_000);

afterAll(() => {
  if (ORIGINAL_DB !== undefined) process.env.SOCMED_DB_PATH = ORIGINAL_DB;
  if (ORIGINAL_UPLOADS !== undefined) process.env.SOCMED_UPLOADS_DIR = ORIGINAL_UPLOADS;
  try {
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows can hold SQLite file locks briefly — best-effort cleanup.
  }
});

async function seedAccount(
  label: string,
  platform = "x",
  creds?: Record<string, unknown>,
): Promise<number> {
  const { sqlite } = await import("@db/client");
  const now = Math.floor(Date.now() / 1000);
  const row = sqlite
    .prepare(
      `INSERT INTO accounts (platform, label, handle, encrypted_creds, creds_iv, creds_tag, webhook_secret, created_at)
       VALUES (?, ?, 'handle', ?, ?, ?, 'secret', ?) RETURNING id`,
    )
    .get(platform, label, Buffer.alloc(4), Buffer.alloc(12), Buffer.alloc(16), now) as { id: number };
  // The envelope key is derived from the account id, so real creds can only be
  // written once the row exists.
  if (creds) {
    const { saveAccountCreds } = await import("@platforms/creds");
    saveAccountCreds(row.id, creds as { accessToken: string });
  }
  return row.id;
}

describe("job handlers", () => {
  // Regression: handlers used to pass a domain id (postId / ruleId / actionId) to
  // complete()/fail(), which take a jobs.id. The job stayed 'running' forever and an
  // unrelated job row with the matching id got clobbered. Offsetting the two id
  // sequences below is what makes the bug observable.
  it("marks the job row — not the domain row — as done", async () => {
    const { sqlite } = await import("@db/client");
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext } = await import("@/lib/queue/claim");
    const { handleJob } = await import("@/lib/queue/handlers");

    const accountId = await seedAccount("done-case");
    const now = Math.floor(Date.now() / 1000);

    // Push the rule id well past any job id so a mix-up cannot coincidentally pass.
    sqlite
      .prepare(
        `INSERT INTO schedule_rules (id, account_id, name, cron_expr, timezone, enabled, next_run_at, created_at)
         VALUES (500, ?, 'weekly', '0 9 * * 1', 'UTC', 1, ?, ?)`,
      )
      .run(accountId, now, now);

    const jobId = enqueue("schedule_rule", { ruleId: 500 });
    expect(jobId).toBeLessThan(500);
    claimNext(now + 1);

    await handleJob("schedule_rule", { ruleId: 500 }, jobId);

    const job = sqlite.prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId) as { status: string };
    expect(job.status).toBe("done");
  });

  it("retries the job row that actually failed", async () => {
    const { sqlite } = await import("@db/client");
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext } = await import("@/lib/queue/claim");
    const { handleJob } = await import("@/lib/queue/handlers");

    const now = Math.floor(Date.now() / 1000);
    // A bystander job whose id collides with the missing rule id referenced below.
    const bystander = enqueue("publish_post", { postId: 1 }, { runAt: now + 3600 });

    const jobId = enqueue("schedule_rule", { ruleId: bystander });
    claimNext(now + 1);
    claimNext(now + 1);

    // Rule `bystander` does not exist, so the handler takes its not-found path.
    await handleJob("schedule_rule", { ruleId: bystander }, jobId);

    const failed = sqlite
      .prepare(`SELECT status, last_error, run_at FROM jobs WHERE id = ?`)
      .get(jobId) as { status: string; last_error: string | null; run_at: number };
    // attempts (1) < max_attempts (5) → back to pending with backoff, error recorded.
    expect(failed.status).toBe("pending");
    expect(failed.last_error).toContain("not found");
    expect(failed.run_at).toBeGreaterThan(now);

    const untouched = sqlite
      .prepare(`SELECT last_error, run_at FROM jobs WHERE id = ?`)
      .get(bystander) as { last_error: string | null; run_at: number };
    expect(untouched.last_error).toBeNull();
    expect(untouched.run_at).toBe(now + 3600);
  });

  it("fails the job on an unknown kind", async () => {
    const { sqlite } = await import("@db/client");
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext } = await import("@/lib/queue/claim");
    const { handleJob } = await import("@/lib/queue/handlers");

    const jobId = enqueue("publish_post", {});
    claimNext(Math.floor(Date.now() / 1000) + 1);
    await handleJob("nope", {}, jobId);

    const job = sqlite.prepare(`SELECT last_error FROM jobs WHERE id = ?`).get(jobId) as {
      last_error: string | null;
    };
    expect(job.last_error).toContain("unknown job kind");
  });
});

describe("token refresh selection", () => {
  it("enqueues refreshes only for active accounts inside the expiry window", async () => {
    const { sqlite } = await import("@db/client");
    const { enqueueDueRefreshes, REFRESH_LEAD_SEC } = await import("@/lib/queue/tokens");

    const now = Math.floor(Date.now() / 1000);
    const soon = await seedAccount("expiring-soon");
    const later = await seedAccount("expiring-later");
    const never = await seedAccount("no-expiry");
    const dead = await seedAccount("already-expired-status");

    sqlite.prepare(`UPDATE accounts SET token_expires_at = ? WHERE id = ?`).run(now + 60, soon);
    sqlite.prepare(`UPDATE accounts SET token_expires_at = ? WHERE id = ?`).run(now + REFRESH_LEAD_SEC + 3600, later);
    // `never` keeps a null expiry — a non-expiring credential has no signal to act on.
    sqlite.prepare(`UPDATE accounts SET token_expires_at = ?, status = 'expired' WHERE id = ?`).run(now + 60, dead);

    expect(enqueueDueRefreshes(now)).toBe(1);
    expect(enqueueDueRefreshes(now)).toBe(0);

    const forSoon = sqlite
      .prepare(`SELECT COUNT(*) as n FROM jobs WHERE kind = 'refresh_token' AND payload = ?`)
      .get(JSON.stringify({ accountId: soon })) as { n: number };
    expect(forSoon.n).toBe(1);

    for (const id of [later, never, dead]) {
      const row = sqlite
        .prepare(`SELECT COUNT(*) as n FROM jobs WHERE kind = 'refresh_token' AND payload = ?`)
        .get(JSON.stringify({ accountId: id })) as { n: number };
      expect(row.n).toBe(0);
    }
  });
});

describe("handleRefreshToken", () => {
  async function runRefresh(accountId: number): Promise<number> {
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext } = await import("@/lib/queue/claim");
    const { handleJob } = await import("@/lib/queue/handlers");
    const jobId = enqueue("refresh_token", { accountId });
    claimNext(Math.floor(Date.now() / 1000) + 1);
    await handleJob("refresh_token", { accountId }, jobId);
    return jobId;
  }

  it("stores the new creds and reactivates the account on success", async () => {
    const { sqlite } = await import("@db/client");
    // Mastodon tokens do not expire, so its refresh() just hands the creds back —
    // which exercises the whole success path without touching the network.
    const id = await seedAccount("mastodon-ok", "mastodon", { accessToken: "tok" });
    sqlite.prepare(`UPDATE accounts SET status = 'expired' WHERE id = ?`).run(id);

    const jobId = await runRefresh(id);

    const acct = sqlite
      .prepare(`SELECT status, last_refresh_at FROM accounts WHERE id = ?`)
      .get(id) as { status: string; last_refresh_at: number | null };
    expect(acct.status).toBe("active");
    expect(acct.last_refresh_at).not.toBeNull();
    const job = sqlite.prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId) as { status: string };
    expect(job.status).toBe("done");
  });

  it("does not flag the account while retries remain", async () => {
    const { sqlite } = await import("@db/client");
    // Empty token makes Mastodon's refresh throw a plain Error — the shape of a
    // transient failure, as opposed to a permanent one.
    const id = await seedAccount("mastodon-transient", "mastodon", { accessToken: "" });

    const jobId = await runRefresh(id);

    const acct = sqlite.prepare(`SELECT status FROM accounts WHERE id = ?`).get(id) as { status: string };
    // Flagging on the first failure would surface "expired" in the UI for a blip
    // the next retry fixes.
    expect(acct.status).toBe("active");
    const job = sqlite.prepare(`SELECT status, last_error FROM jobs WHERE id = ?`).get(jobId) as {
      status: string;
      last_error: string | null;
    };
    expect(job.status).toBe("pending");
    expect(job.last_error).toContain("refresh_token:");
  });

  it("flags the account once retries are exhausted", async () => {
    const { sqlite } = await import("@db/client");
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { handleJob } = await import("@/lib/queue/handlers");
    const id = await seedAccount("mastodon-exhausted", "mastodon", { accessToken: "" });

    const jobId = enqueue("refresh_token", { accountId: id }, { maxAttempts: 1 });
    sqlite.prepare(`UPDATE jobs SET attempts = 1, status = 'running' WHERE id = ?`).run(jobId);
    await handleJob("refresh_token", { accountId: id }, jobId);

    const acct = sqlite.prepare(`SELECT status FROM accounts WHERE id = ?`).get(id) as { status: string };
    expect(acct.status).toBe("expired");
    const job = sqlite.prepare(`SELECT status FROM jobs WHERE id = ?`).get(jobId) as { status: string };
    expect(job.status).toBe("dead");
  });

  it("treats a platform with no refresh grant as terminal, not retryable", async () => {
    const { sqlite } = await import("@db/client");
    // Discord bot tokens have no refresh flow at all; retrying can never succeed.
    const id = await seedAccount("discord-bot", "discord", { accessToken: "bot-token" });

    const jobId = await runRefresh(id);

    const acct = sqlite.prepare(`SELECT status FROM accounts WHERE id = ?`).get(id) as { status: string };
    expect(acct.status).toBe("expired");
    const job = sqlite.prepare(`SELECT status, attempts FROM jobs WHERE id = ?`).get(jobId) as {
      status: string;
      attempts: number;
    };
    // Closed out immediately rather than burning five backoff cycles on it.
    expect(job.status).toBe("done");
    expect(job.attempts).toBe(1);
  });
});

describe("schedule rule firing", () => {
  it("advances next_run_at to the real next cron occurrence", async () => {
    const { sqlite } = await import("@db/client");
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext } = await import("@/lib/queue/claim");
    const { handleJob } = await import("@/lib/queue/handlers");

    const accountId = await seedAccount("cron-advance");
    const now = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO schedule_rules (id, account_id, name, cron_expr, timezone, enabled, next_run_at, created_at)
         VALUES (600, ?, 'daily 9am', '0 9 * * *', 'UTC', 1, ?, ?)`,
      )
      .run(accountId, now - 60, now);

    const jobId = enqueue("schedule_rule", { ruleId: 600 });
    claimNext(now + 1);
    await handleJob("schedule_rule", { ruleId: 600 }, jobId);

    const rule = sqlite
      .prepare(`SELECT next_run_at, last_run_at, enabled FROM schedule_rules WHERE id = 600`)
      .get() as { next_run_at: number; last_run_at: number; enabled: number };
    expect(rule.enabled).toBe(1);
    expect(rule.next_run_at).toBeGreaterThan(now);
    // The old placeholder was always now + 3600; a real 09:00 UTC rule must land
    // on a 09:00 UTC boundary instead.
    expect(rule.next_run_at % 86400).toBe(9 * 3600);
    expect(rule.last_run_at).toBeGreaterThanOrEqual(now);

    // The occurrence itself publishes now, not an hour out.
    const post = sqlite
      .prepare(`SELECT id, status, scheduled_for FROM posts WHERE account_id = ? ORDER BY id DESC LIMIT 1`)
      .get(accountId) as { id: number; status: string; scheduled_for: number };
    expect(post.status).toBe("scheduled");
    expect(post.scheduled_for).toBeLessThanOrEqual(now + 5);

    const publishJob = sqlite
      .prepare(`SELECT run_at FROM jobs WHERE kind = 'publish_post' AND payload = ?`)
      .get(JSON.stringify({ postId: post.id })) as { run_at: number } | undefined;
    expect(publishJob).toBeDefined();
    expect(publishJob!.run_at).toBeLessThanOrEqual(now + 5);
  });

  it("disables a rule whose cron expression is unusable", async () => {
    const { sqlite } = await import("@db/client");
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { claimNext } = await import("@/lib/queue/claim");
    const { handleJob } = await import("@/lib/queue/handlers");

    const accountId = await seedAccount("cron-broken");
    const now = Math.floor(Date.now() / 1000);
    // Bypasses the API validator, which is exactly how a bad row survives: an
    // older release, a hand-edited DB, or a restored backup.
    sqlite
      .prepare(
        `INSERT INTO schedule_rules (id, account_id, name, cron_expr, timezone, enabled, next_run_at, created_at)
         VALUES (601, ?, 'broken', 'not a cron', 'UTC', 1, ?, ?)`,
      )
      .run(accountId, now - 60, now);

    const jobId = enqueue("schedule_rule", { ruleId: 601 });
    claimNext(now + 1);
    await handleJob("schedule_rule", { ruleId: 601 }, jobId);

    const rule = sqlite.prepare(`SELECT enabled FROM schedule_rules WHERE id = 601`).get() as { enabled: number };
    // Left enabled, the cron poller would refire this rule on every tick forever.
    expect(rule.enabled).toBe(0);
    const job = sqlite.prepare(`SELECT last_error FROM jobs WHERE id = ?`).get(jobId) as { last_error: string | null };
    expect(job.last_error).toContain("expected 5 fields");
  });
});

describe("due-work selection", () => {
  it("enqueues each due rule once, however often it is polled", async () => {
    const { sqlite } = await import("@db/client");
    const { enqueueDueRules } = await import("@/lib/schedule/rules");

    const accountId = await seedAccount("due-rules");
    const now = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO schedule_rules (id, account_id, name, cron_expr, timezone, enabled, next_run_at, created_at)
         VALUES (700, ?, 'due', '0 9 * * *', 'UTC', 1, ?, ?), (701, ?, 'later', '0 9 * * *', 'UTC', 1, ?, ?), (702, ?, 'paused', '0 9 * * *', 'UTC', 0, ?, ?)`,
      )
      .run(accountId, now - 10, now, accountId, now + 86400, now, accountId, now - 10, now);

    expect(enqueueDueRules(now)).toBe(1);
    // A rule stays due until its job runs; polling again must not stack a duplicate.
    expect(enqueueDueRules(now)).toBe(0);

    const jobs = sqlite
      .prepare(`SELECT COUNT(*) as n FROM jobs WHERE kind = 'schedule_rule' AND payload = ?`)
      .get(JSON.stringify({ ruleId: 700 })) as { n: number };
    expect(jobs.n).toBe(1);
  });
});
