import { sqlite } from "@db/client";
import type { JobKind } from "@db/schema";

export interface EnqueueOptions {
  runAt?: number; // unix seconds; default = now
  maxAttempts?: number;
}

export function enqueue(
  kind: JobKind,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
): number {
  const runAt = opts.runAt ?? Math.floor(Date.now() / 1000);
  const maxAttempts = opts.maxAttempts ?? 5;
  const row = sqlite
    .prepare(
      `INSERT INTO jobs (kind, payload, run_at, max_attempts, created_at)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(kind, JSON.stringify(payload), runAt, maxAttempts, Math.floor(Date.now() / 1000)) as
    | { id: number }
    | undefined;
  if (!row) throw new Error("enqueue: failed to insert job");
  return row.id;
}

/**
 * Drops still-pending publish jobs for a post. Returns how many were removed.
 *
 * Rescheduling or publishing a post must not leave the previous job queued, or
 * the post goes out twice. The rows are deleted rather than marked done/dead:
 * the jobs status enum has no "cancelled", and reusing either of those would
 * skew the queue counters on /api/health. A job already claimed ('running') is
 * left alone — that publish is in flight and cannot be recalled here.
 */
export function cancelPendingPublish(postId: number): number {
  const info = sqlite
    .prepare(`DELETE FROM jobs WHERE kind = 'publish_post' AND status = 'pending' AND payload = ?`)
    .run(JSON.stringify({ postId }));
  return info.changes;
}
