// Polls every 30 min: enqueue refresh_token for any active account whose stored
// token expires within the lead window. The selection + dedupe logic lives in
// app/lib/queue/tokens.ts so it is covered by the app test suite.

import { enqueueDueRefreshes } from "../../../app/lib/queue/tokens";

const POLL_MS = 30 * 60 * 1000; // 30 min

let handle: ReturnType<typeof setInterval> | null = null;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [tokens] ${msg}`);
}

async function tick(): Promise<void> {
  const enqueued = enqueueDueRefreshes();
  if (enqueued > 0) log(`enqueued ${enqueued} refresh_token jobs`);
}

export function startTokenPoller(): void {
  if (handle) return;
  log("starting token refresh poller");
  handle = setInterval(() => {
    tick().catch((e) => log(`tick error: ${e instanceof Error ? e.message : String(e)}`));
  }, POLL_MS);
  // Fire once at boot: a worker that was down over a token's expiry window would
  // otherwise wait a full interval before noticing.
  tick().catch((e) => log(`initial tick error: ${e instanceof Error ? e.message : String(e)}`));
}

export function stopTokenPoller(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  log("token refresh poller stopped");
}
