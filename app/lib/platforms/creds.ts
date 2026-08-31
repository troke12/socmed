import { eq } from "drizzle-orm";
import { db } from "@db/client";
import { accounts } from "@db/schema";
import { decryptJson, encryptJson, pack, unpack } from "./crypto";
import type { Account } from "@db/schema";
import type { EncryptedCreds } from "./types";

// Shared credential decryption used by queue handlers, pollers, and worker.
// Keeping it in one place avoids the 3x duplication across queue modules.
export function decryptAccountCreds(account: Pick<Account, "id" | "encryptedCreds" | "credsIv" | "credsTag">): Record<string, unknown> {
  const ct = unpack(account.encryptedCreds, account.credsIv, account.credsTag);
  return decryptJson<Record<string, unknown>>(account.id, ct);
}

/**
 * Re-encrypt and store an account's creds. Used by adapters that mint
 * short-lived tokens at call time (e.g. Bluesky's ~2h accessJwt) so the next
 * job reuses the live session instead of re-authenticating every time.
 * tokenExpiresAt is kept in sync so the UI shows the real expiry.
 */
export function saveAccountCreds(accountId: number, creds: EncryptedCreds): void {
  const packed = pack(encryptJson(accountId, creds));
  db.update(accounts)
    .set({
      encryptedCreds: packed.encryptedCreds,
      credsIv: packed.credsIv,
      credsTag: packed.credsTag,
      tokenExpiresAt: creds.expiresAt ?? null,
    })
    .where(eq(accounts.id, accountId))
    .run();
}
