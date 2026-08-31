import { enqueue } from "./db";
import { scheduleRules } from "../../app/lib/db/schema";
import { eq, lte, and } from "drizzle-orm";
import { db } from "./db";

const POLL_MS = 60_000;
let handle: ReturnType<typeof setInterval> | null = null;

function log(msg: string): void {
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
    // Enqueue a schedule_rule job; the handler creates a post from the
    // template and schedules the next run (hourly placeholder for now).
    try {
      enqueue("schedule_rule", { ruleId: rule.id });
      log(`rule ${rule.id} (${rule.name}) fired`);
    } catch (e) {
      log(`rule ${rule.id} enqueue failed: ${e instanceof Error ? e.message : String(e)}`);
    }
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
