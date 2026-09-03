// Ticks hourly but only ever writes one snapshot per account per day. The
// selection logic lives in app/lib/queue/audience.ts so the app test suite
// covers it.
//
// Hourly rather than daily on purpose: a worker that is restarted, or down over
// midnight, still captures today's point instead of skipping the day entirely.

import { enqueueDueAudienceSnapshots } from "../../../app/lib/queue/audience";

const POLL_MS = 60 * 60 * 1000; // 1 hour

let handle: ReturnType<typeof setInterval> | null = null;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [audience] ${msg}`);
}

async function tick(): Promise<void> {
  const enqueued = enqueueDueAudienceSnapshots();
  if (enqueued > 0) log(`enqueued ${enqueued} audience snapshots`);
}

export function startAudiencePoller(): void {
  if (handle) return;
  log("starting audience poller");
  handle = setInterval(() => {
    tick().catch((e) => log(`tick error: ${e instanceof Error ? e.message : String(e)}`));
  }, POLL_MS);
  tick().catch((e) => log(`initial tick error: ${e instanceof Error ? e.message : String(e)}`));
}

export function stopAudiencePoller(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  log("audience poller stopped");
}
