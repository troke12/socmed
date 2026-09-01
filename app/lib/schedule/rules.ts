import { sqlite } from "@db/client";
import { enqueue } from "@/lib/queue/enqueue";

/**
 * Enqueues a schedule_rule job for every enabled rule that has come due.
 * Returns the number of jobs enqueued.
 *
 * A rule's next_run_at only advances once its job actually runs, so a rule stays
 * "due" for as long as the job sits in the queue. Without the in-flight check
 * below, a backed-up queue would stack one duplicate job per poller tick and
 * publish the same content many times over.
 */
export function enqueueDueRules(now: number = Math.floor(Date.now() / 1000)): number {
  const due = sqlite
    .prepare(`SELECT id, name FROM schedule_rules WHERE enabled = 1 AND next_run_at <= ?`)
    .all(now) as { id: number; name: string }[];

  let enqueued = 0;
  for (const rule of due) {
    // Matches the exact payload string enqueue() writes, so the object shape
    // here must stay byte-identical to the enqueue call below.
    const inFlight = sqlite
      .prepare(
        `SELECT 1 FROM jobs
          WHERE kind = 'schedule_rule'
            AND status IN ('pending', 'running')
            AND payload = ?`,
      )
      .get(JSON.stringify({ ruleId: rule.id }));
    if (inFlight) continue;
    enqueue("schedule_rule", { ruleId: rule.id });
    enqueued++;
  }
  return enqueued;
}
