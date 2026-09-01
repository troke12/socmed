import { notifyConfig, isEnabled, wants } from "./config";
import { transportsFor } from "./transports";
import type { Notification } from "./types";

export type { Notification, NotifyEvent, Transport } from "./types";
export { notifyConfig, isEnabled, wants } from "./config";
export { transportsFor } from "./transports";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [notify] ${msg}`);
}

/**
 * Sends a notification through every configured transport.
 *
 * Never throws. This is called from queue handlers and pollers, where a failing
 * notification endpoint must not fail the job that triggered it — the post
 * publishing correctly matters more than the alert about it being delivered.
 * Transports run in parallel so one slow endpoint does not delay the others.
 */
export async function notify(n: Notification): Promise<void> {
  const config = notifyConfig();
  if (!isEnabled(config) || !wants(config, n.event)) return;

  const results = await Promise.allSettled(
    transportsFor(config).map(async (t) => {
      try {
        await t.send(n);
      } catch (err) {
        throw new Error(`${t.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  for (const r of results) {
    if (r.status === "rejected") {
      log(`delivery failed — ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  }
}
