import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { decryptAccountCreds } from "@platforms/creds";
import { db, sqlite } from "@db/client";
import { accounts, posts } from "@db/schema";
import { eq } from "drizzle-orm";
import { complete, fail } from "./claim";

interface FetchMetricsPayload {
  postId: number;
}

export async function handleFetchMetrics(payload: FetchMetricsPayload): Promise<void> {
  const { postId } = payload;
  const post = db.select().from(posts).where(eq(posts.id, postId)).get();
  if (!post || !post.platformPostId) {
    fail(postId, `post ${postId} not published`);
    return;
  }
  const account = db.select().from(accounts).where(eq(accounts.id, post.accountId)).get();
  if (!account) {
    fail(postId, `account not found for post ${postId}`);
    return;
  }
  const creds = decryptAccountCreds(account);
  const adapter = getAdapter(account.platform);
  try {
    const snap = await adapter.fetchPostMetrics(
      post.platformPostId,
      typeof creds.accessToken === "string" ? creds.accessToken : "",
      Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60,
      { post, account: { ...account, _creds: creds } },
    );
    sqlite
      .prepare(
        `INSERT INTO analytics_snapshots
          (post_id, account_id, platform, captured_at, impressions, reach, likes, comments, shares, saves, video_views, watch_time_ms, engagement_rate, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        postId,
        account.id,
        account.platform,
        Math.floor(Date.now() / 1000),
        snap.impressions,
        snap.reach,
        snap.likes,
        snap.comments,
        snap.shares,
        snap.saves,
        snap.videoViews,
        snap.watchTimeMs,
        snap.engagementRate,
        snap.raw ? JSON.stringify(snap.raw) : null,
      );
    complete(postId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(postId, `fetch_metrics: ${msg}`);
  }
}
