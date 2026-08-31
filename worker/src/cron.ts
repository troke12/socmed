import { enqueue } from "./db";
import { sqlite } from "./db";
import { scheduleRules } from "../../app/lib/db/schema";
import { eq, lte, and } from "drizzle-orm";
import { db } from "./db";

const POLL_MS = 60_000;
let handle: ReturnType<typeof setInterval> | null = null;

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] [cron] ${msg}`);
}

async function tick(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // Find all enabled rules whose next_run_at <= now
  const due = db
    .select()
    .from(scheduleRules)
    .where(and(eq(scheduleRules.enabled, 1), lte(scheduleRules.nextRunAt, now)))
    .all();
  for (const rule of due) {
    // Enqueue a schedule_rule job; the handler will create a post from the template
    // (M3+ wires the actual platform; for now we just bump next_run_at and log).
    enqueue("schedule_rule", { ruleId: rule.id });
    // Bump next_run_at to one hour later (placeholder; M3+ replaces with cron calc)
    const next = now + 60 * 60;
    sqlite.prepare(`UPDATE schedule_rules SET next_run_at = ?, last_run_at = ? WHERE id = ?`).run(next, now, rule.id);
    log(`rule ${rule.id} (${rule.name}) fired; next at ${new Date(next * 1000).toISOString()}`);
  }
}

export function startCron(): void {
  if (handle) return;
  log("starting cron poller");
  handle = setInterval(() => {
    tick().catch((e) => log(`tick error: ${e instanceof Error ? e.message : String(e)}`));
  }, POLL_MS);
}

export function stopCron(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  log("cron poller stopped");
}
