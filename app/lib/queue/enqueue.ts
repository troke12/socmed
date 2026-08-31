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
