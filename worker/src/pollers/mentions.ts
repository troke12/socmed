// Polls every 10 min: for every active account, fetch recent mentions via
// the adapter and insert new ones into the mentions table.

import { eq } from "drizzle-orm";
import { db, sqlite } from "../db";
import { accounts } from "../../../app/lib/db/schema";
import { getAdapter } from "../../../app/lib/platforms/registry";
import "../../../app/lib/platforms/bootstrap";
import { decryptAccountCreds } from "../../../app/lib/platforms/creds";
import { notify } from "../../../app/lib/notify";

const POLL_MS = 10 * 60 * 1000; // 10 min
const LOOKBACK_SEC = 24 * 60 * 60; // 24h
let handle: ReturnType<typeof setInterval> | null = null;

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [mentions] ${msg}`);
}

async function tick(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - LOOKBACK_SEC;
  const active = db.select().from(accounts).where(eq(accounts.status, "active")).all();
  let totalNew = 0;
  // Collected per account so the notification can say where the mentions came
  // from instead of just giving a bare count.
  const newByAccount: { label: string; platform: string; count: number }[] = [];
  for (const acc of active) {
    let accountNew = 0;
    try {
      const creds = decryptAccountCreds(acc);
      const adapter = getAdapter(acc.platform);
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
        if (insert.changes > 0) {
          totalNew++;
          accountNew++;
        }
      }
      if (accountNew > 0) newByAccount.push({ label: acc.label, platform: acc.platform, count: accountNew });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Keep going — one bad account (corrupt creds, revoked token) must not
      // abort the whole pass. Include the error stack for context.
      log(`${acc.platform}/${acc.label}: fetch failed — ${msg}${e instanceof Error ? `\n${e.stack ?? ""}` : ""}`);
    }
  }
  if (totalNew > 0) {
    log(`inserted ${totalNew} new mentions`);
    // One message per tick, not per mention: a burst of forty replies should
    // be one alert saying forty, not forty alerts.
    await notify({
      event: "new_mentions",
      title: `${totalNew} new mention${totalNew === 1 ? "" : "s"}`,
      body: newByAccount.map((a) => `${a.count} on ${a.platform} (${a.label})`).join("\n"),
      path: "/inbox",
      data: { total: totalNew, accounts: newByAccount },
    });
  }
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
