import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { decryptAccountCreds, saveAccountCreds } from "@platforms/creds";
import { db, sqlite } from "@db/client";
import { accounts } from "@db/schema";
import { RefreshUnsupportedError, type DecryptedCreds, type EncryptedCreds } from "@platforms/types";
import { eq } from "drizzle-orm";
import { complete, fail } from "./claim";
import { enqueue } from "./enqueue";
import { notify } from "@/lib/notify";

export interface RefreshTokenPayload {
  accountId: number;
}

// Refresh this far ahead of the recorded expiry. Wide enough that a handful of
// failed attempts still land inside the window before the token actually dies,
// since claim.ts backs off 5m/30m/2h/6h/24h between retries.
export const REFRESH_LEAD_SEC = 24 * 60 * 60;

async function markExpired(account: { id: number; platform: string; label: string }, reason: string): Promise<void> {
  sqlite.prepare(`UPDATE accounts SET status = 'expired' WHERE id = ?`).run(account.id);
  await notify({
    event: "account_expired",
    title: `${account.platform} account "${account.label}" needs re-authorising`,
    body: `Token refresh failed and the account is now marked expired. Publishing to it will fail until it is reconnected.\n\n${reason}`,
    path: "/accounts",
    data: { accountId: account.id, platform: account.platform, label: account.label, reason },
  });
}

export async function handleRefreshToken(payload: RefreshTokenPayload, jobId: number): Promise<void> {
  const { accountId } = payload;
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) {
    fail(jobId, `account ${accountId} not found`);
    return;
  }

  const adapter = getAdapter(account.platform);
  if (!adapter.refresh) {
    complete(jobId);
    return;
  }

  try {
    // decryptAccountCreds hands back an untyped bag by design — the shape varies
    // per platform, and each adapter's refresh() is what knows its own fields.
    const creds = decryptAccountCreds(account) as unknown as DecryptedCreds;
    const next = (await adapter.refresh(creds)) as EncryptedCreds;
    // saveAccountCreds also syncs tokenExpiresAt, which is what the poller reads
    // to decide the next refresh — without it the account would be re-enqueued
    // on every tick.
    saveAccountCreds(accountId, next);
    sqlite
      .prepare(`UPDATE accounts SET last_refresh_at = ?, status = 'active' WHERE id = ?`)
      .run(Math.floor(Date.now() / 1000), accountId);
    complete(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof RefreshUnsupportedError) {
      // The platform has no refresh grant; the account really does need manual
      // re-auth. Flag it now and close the job — retrying is pure waste.
      await markExpired(account, msg);
      complete(jobId);
      return;
    }
    // Only flag the account once the queue is about to dead-letter the job.
    // Flagging on the first failure would show "expired" in the UI for a
    // transient network blip that the very next retry fixes. This mirrors the
    // dead-letter condition in claim.ts:fail().
    const row = sqlite.prepare(`SELECT attempts, max_attempts FROM jobs WHERE id = ?`).get(jobId) as
      | { attempts: number; max_attempts: number }
      | undefined;
    if (row && row.attempts >= row.max_attempts) await markExpired(account, msg);
    fail(jobId, `refresh_token: ${msg}`);
  }
}

/**
 * Enqueues a refresh_token job for every active account whose token expires
 * within REFRESH_LEAD_SEC. Returns the number of jobs enqueued.
 *
 * Accounts with a null tokenExpiresAt are skipped deliberately: that means either
 * a non-expiring credential (Discord bot token, Bluesky app password) or a
 * platform that never told us an expiry, and there is no signal to act on.
 * Already-past expiries are still attempted — most refresh grants outlive the
 * access token they mint.
 */
export function enqueueDueRefreshes(now: number = Math.floor(Date.now() / 1000)): number {
  const due = sqlite
    .prepare(
      `SELECT id FROM accounts
        WHERE status = 'active'
          AND token_expires_at IS NOT NULL
          AND token_expires_at <= ?`,
    )
    .all(now + REFRESH_LEAD_SEC) as { id: number }[];

  let enqueued = 0;
  for (const { id } of due) {
    // Dedupe against an in-flight job for the same account. Matches on the exact
    // payload string enqueue() writes, so the object shape here must stay
    // byte-identical to the enqueue call below.
    const inFlight = sqlite
      .prepare(
        `SELECT 1 FROM jobs
          WHERE kind = 'refresh_token'
            AND status IN ('pending', 'running')
            AND payload = ?`,
      )
      .get(JSON.stringify({ accountId: id }));
    if (inFlight) continue;
    enqueue("refresh_token", { accountId: id });
    enqueued++;
  }
  return enqueued;
}
