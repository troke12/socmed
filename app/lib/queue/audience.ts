import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { decryptAccountCreds } from "@platforms/creds";
import { db, sqlite } from "@db/client";
import { accounts, type Post } from "@db/schema";
import { eq } from "drizzle-orm";
import { complete, fail } from "./claim";
import { enqueue } from "./enqueue";

export interface FetchAudiencePayload {
  accountId: number;
}

const DAY = 24 * 60 * 60;

/**
 * Snapshots are bucketed to midnight UTC.
 *
 * A growth chart wants one point per account per day, and the unique index is on
 * (account_id, captured_at) — so storing the raw poll time would let a restarted
 * worker write several rows for the same day and make a step look like a spike.
 */
export function dayBucket(now: number = Math.floor(Date.now() / 1000)): number {
  return Math.floor(now / DAY) * DAY;
}

/**
 * Adapters take an AdapterContext built around a post, which an account-level
 * call has none of. This is the minimum shape that satisfies the type without
 * pretending to be a real row — id 0 never matches anything.
 */
function contextPost(accountId: number): Post {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: 0,
    accountId,
    kind: "text",
    status: "published",
    caption: "",
    hashtags: "",
    linkUrl: null,
    campaign: null,
    firstComment: null,
    firstCommentPostedAt: null,
    scheduledFor: null,
    publishedAt: now,
    platformPostId: null,
    platformPostUrl: null,
    error: null,
    attemptCount: 0,
    reviewStatus: "none",
    authorId: null,
    reviewerId: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function handleFetchAudience(payload: FetchAudiencePayload, jobId: number): Promise<void> {
  const { accountId } = payload;
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) {
    fail(jobId, `account ${accountId} not found`);
    return;
  }

  const adapter = getAdapter(account.platform);
  if (!adapter.fetchAudience) {
    // Terminal: no amount of retrying gives the platform an endpoint.
    complete(jobId);
    return;
  }

  try {
    const creds = decryptAccountCreds(account);
    const counts = await adapter.fetchAudience(
      typeof creds.accessToken === "string" ? creds.accessToken : "",
      { post: contextPost(accountId), account: { ...account, _creds: creds } },
    );

    // Upsert on the day bucket so re-running for the same day corrects the
    // figure rather than failing on the unique index or adding a duplicate.
    sqlite
      .prepare(
        `INSERT INTO audience_snapshots (account_id, platform, captured_at, followers, following, posts, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, captured_at) DO UPDATE SET
           followers = excluded.followers,
           following = excluded.following,
           posts = excluded.posts,
           raw_json = excluded.raw_json`,
      )
      .run(
        accountId,
        account.platform,
        dayBucket(),
        counts.followers ?? null,
        counts.following ?? null,
        counts.posts ?? null,
        counts.raw ? JSON.stringify(counts.raw) : null,
      );
    complete(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(jobId, `fetch_audience: ${msg}`);
  }
}

/**
 * Enqueues an audience snapshot for every active account that has no row for
 * today yet. Returns the number enqueued.
 *
 * Only accounts whose adapter can actually answer are considered — enqueueing
 * for the rest would put a job on the queue solely to complete as a no-op.
 */
export function enqueueDueAudienceSnapshots(now: number = Math.floor(Date.now() / 1000)): number {
  const today = dayBucket(now);
  const rows = db
    .select({ id: accounts.id, platform: accounts.platform })
    .from(accounts)
    .where(eq(accounts.status, "active"))
    .all();

  let enqueued = 0;
  for (const row of rows) {
    if (!getAdapter(row.platform).fetchAudience) continue;

    const existing = sqlite
      .prepare(`SELECT 1 FROM audience_snapshots WHERE account_id = ? AND captured_at = ?`)
      .get(row.id, today);
    if (existing) continue;

    // Matches the exact payload string enqueue() writes, so the object shape
    // here must stay byte-identical to the enqueue call below.
    const inFlight = sqlite
      .prepare(
        `SELECT 1 FROM jobs
          WHERE kind = 'fetch_audience'
            AND status IN ('pending', 'running')
            AND payload = ?`,
      )
      .get(JSON.stringify({ accountId: row.id }));
    if (inFlight) continue;

    enqueue("fetch_audience", { accountId: row.id });
    enqueued++;
  }
  return enqueued;
}
