// Ticks every minute and fires any schedule rule that has come due. The
// selection + dedupe logic lives in app/lib/schedule/rules.ts so it is covered
// by the app test suite.

import { enqueueDueRules } from "../../app/lib/schedule/rules";

const POLL_MS = 60_000;
let handle: ReturnType<typeof setInterval> | null = null;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [cron] ${msg}`);
}

async function tick(): Promise<void> {
  const enqueued = enqueueDueRules();
  if (enqueued > 0) log(`fired ${enqueued} schedule rules`);
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
