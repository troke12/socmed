import { claimNext } from "./db";
import { handleJob } from "./db";
import { fail } from "./db";

const POLL_MS = 5_000;

let running = false;
let currentJobId: number | null = null;

function log(msg: string): void {
   
  console.log(`[${new Date().toISOString()}] [scheduler] ${msg}`);
}

async function tick(): Promise<void> {
  if (running) return;
  const job = claimNext();
  if (!job) return;
  running = true;
  currentJobId = job.id;
  log(`claimed job ${job.id} kind=${job.kind} attempt=${job.attempts}/${job.max_attempts}`);
  try {
    const payload = JSON.parse(job.payload) as Record<string, unknown>;
    await handleJob(job.kind, payload, job.id);
    log(`job ${job.id} ok`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? "" : "";
    log(`job ${job.id} error: ${msg}\n${stack}`);
    // handler is responsible for marking complete/fail; if it threw, mark failed
    try {
      fail(job.id, msg);
    } catch (e) {
      log(`failed to record error: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    running = false;
    currentJobId = null;
  }
}

let handle: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (handle) return;
  log("starting scheduler");
  handle = setInterval(() => {
    tick().catch((e) => log(`tick error: ${e instanceof Error ? e.message : String(e)}`));
  }, POLL_MS);
  // also fire one tick immediately
  tick().catch((e) => log(`initial tick error: ${e instanceof Error ? e.message : String(e)}`));
}

export function stopScheduler(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  log("scheduler stopped");
}

export function getCurrentJobId(): number | null {
  return currentJobId;
}
