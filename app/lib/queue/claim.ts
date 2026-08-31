import { sqlite } from "@db/client";
import { hostname } from "node:os";

export interface ClaimedJob {
  id: number;
  kind: string;
  payload: string;
  attempts: number;
  max_attempts: number;
}

const CLAIMED_BY = `${hostname()}:${process.pid}`;

// Atomically claim the next due job using UPDATE ... RETURNING inside a tx.
export function claimNext(now: number = Math.floor(Date.now() / 1000)): ClaimedJob | null {
  const tx = sqlite.transaction(() => {
    const row = sqlite
      .prepare(
        `SELECT id, kind, payload, attempts, max_attempts
           FROM jobs
          WHERE status = 'pending' AND run_at <= ?
          ORDER BY run_at ASC, id ASC
          LIMIT 1`,
      )
      .get(now) as ClaimedJob | undefined;
    if (!row) return null;
    sqlite
      .prepare(
        `UPDATE jobs
            SET status = 'running',
                claimed_at = ?,
                claimed_by = ?,
                attempts = attempts + 1
          WHERE id = ? AND status = 'pending'`,
      )
      .run(now, CLAIMED_BY, row.id);
    return row;
  });
  return tx();
}

export function complete(id: number): void {
  sqlite.prepare(`UPDATE jobs SET status = 'done' WHERE id = ?`).run(id);
}

export function fail(id: number, error: string): void {
  const row = sqlite.prepare(`SELECT attempts, max_attempts FROM jobs WHERE id = ?`).get(id) as
    | { attempts: number; max_attempts: number }
    | undefined;
  if (!row) return;
  if (row.attempts >= row.max_attempts) {
    sqlite
      .prepare(`UPDATE jobs SET status = 'dead', last_error = ? WHERE id = ?`)
      .run(error, id);
    return;
  }
  // exponential backoff: 5m, 30m, 2h, 6h, 24h
  const backoff = [5 * 60, 30 * 60, 2 * 60 * 60, 6 * 60 * 60, 24 * 60 * 60];
  const delay = backoff[Math.min(row.attempts - 1, backoff.length - 1)] ?? 24 * 60 * 60;
  const runAt = Math.floor(Date.now() / 1000) + delay;
  sqlite
    .prepare(
      `UPDATE jobs SET status = 'pending', run_at = ?, last_error = ? WHERE id = ?`,
    )
    .run(runAt, error, id);
}

export function queueStats(): {
  pending: number;
  running: number;
  done: number;
  failed: number;
  dead: number;
} {
  const rows = sqlite
    .prepare(`SELECT status, COUNT(*) as n FROM jobs GROUP BY status`)
    .all() as { status: string; n: number }[];
  const out = { pending: 0, running: 0, done: 0, failed: 0, dead: 0 };
  for (const r of rows) {
    if (r.status in out) (out as Record<string, number>)[r.status] = r.n;
  }
  return out;
}
