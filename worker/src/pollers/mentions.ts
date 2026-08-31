// Polls every 10 min: for every active account, fetch recent mentions via
// the adapter and insert new ones into the mentions table.

import { eq } from "drizzle-orm";
import { db, sqlite, enqueue } from "../db";
import { accounts, mentions } from "../../../app/lib/db/schema";
import { getAdapter } from "../../../app/lib/platforms/registry";
import "../../../app/lib/platforms/bootstrap";
import { decryptJson, unpack } from "../../../app/lib/platforms/crypto";

const POLL_MS = 10 * 60 * 1000; // 10 min
const LOOKBACK_SEC = 24 * 60 * 60; // 24h
let handle: ReturnType<typeof setInterval> | null = null;

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] [mentions] ${msg}`);
}

function decrypt(account: typeof accounts.$inferSelect): Record<string, unknown> {
  const ct = unpack(account.encryptedCreds, account.credsIv, account.credsTag);
  return decryptJson<Record<string, unknown>>(account.id, ct);
}

async function tick(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - LOOKBACK_SEC;
  const active = db.select().from(accounts).where(eq(accounts.status, "active")).all();
  let totalNew = 0;
  for (const acc of active) {
    const creds = decrypt(acc);
    const adapter = getAdapter(acc.platform);
    try {
      const result = await adapter.fetchMentions(
        typeof creds.accessToken === "string" ? creds.accessToken : "",
        since,
        { post: { id: 0 } as never, account: { ...acc, _creds: creds } },
      );
      for (const m of result.mentions) {
        const insert = sqlite.prepare(
          `INSERT OR IGNORE INTO mentions
            (account_id, platform, platform_mention_id, author_handle, author_name, text, url, mentioned_at, is_read, raw_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).run(
          acc.id,
          acc.platform,
          m.platformMentionId,
          m.authorHandle,
          m.authorName ?? null,
          m.text,
          m.url ?? null,
          m.mentionedAt,
          m ? JSON.stringify(m) : null,
          now,
        );
        if (insert.changes > 0) totalNew++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`${acc.platform}/${acc.label}: fetch failed — ${msg}`);
    }
  }
  if (totalNew > 0) log(`inserted ${totalNew} new mentions`);
}

export function startMentionsPoller(): void {
  if (handle) return;
  log("starting mentions poller");
  handle = setInterval(() => {
    tick().catch((e) => log(`tick error: ${e instanceof Error ? e.message : String(e)}`));
  }, POLL_MS);
}

export function stopMentionsPoller(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  log("mentions poller stopped");
}

void enqueue; // silence unused
