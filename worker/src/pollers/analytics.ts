// Polls every 15 min: for every published post, enqueue fetch_metrics if the
// most recent snapshot is older than 1 hour.

import { enqueue, db, sqlite } from "../db";
import { posts } from "../../../app/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";

const POLL_MS = 15 * 60 * 1000; // 15 min
const STALE_AFTER_SEC = 60 * 60; // 1 hour

let handle: ReturnType<typeof setInterval> | null = null;

function log(msg: string): void {
   
  console.log(`[${new Date().toISOString()}] [analytics] ${msg}`);
}

async function tick(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - STALE_AFTER_SEC;
  // Find published posts whose latest snapshot is older than cutoff (or no snapshot)
  const published = db
    .select()
    .from(posts)
    .where(and(eq(posts.status, "published"), isNotNull(posts.platformPostId)))
    .all();
  let enqueued = 0;
  for (const p of published) {
    const last = sqlite
      .prepare(`SELECT MAX(captured_at) as t FROM analytics_snapshots WHERE post_id = ?`)
      .get(p.id) as { t: number | null } | undefined;
    if (!last || (last.t ?? 0) < cutoff) {
      enqueue("fetch_metrics", { postId: p.id });
      enqueued++;
    }
  }
  if (enqueued > 0) log(`enqueued ${enqueued} fetch_metrics jobs`);
}

export function startAnalyticsPoller(): void {
  if (handle) return;
  log("starting analytics poller");
  handle = setInterval(() => {
    tick().catch((e) => log(`tick error: ${e instanceof Error ? e.message : String(e)}`));
  }, POLL_MS);
}

export function stopAnalyticsPoller(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  log("analytics poller stopped");
}
