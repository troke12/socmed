import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { mentions, accounts } from "@db/schema";
import { requireSession, requireRole } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";

export const runtime = "nodejs";

export async function GET() {
  try { await requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  await runMigrations();
  const rows = db
    .select({
      id: mentions.id,
      accountId: mentions.accountId,
      platform: mentions.platform,
      platformMentionId: mentions.platformMentionId,
      authorHandle: mentions.authorHandle,
      authorName: mentions.authorName,
      text: mentions.text,
      url: mentions.url,
      mentionedAt: mentions.mentionedAt,
      isRead: mentions.isRead,
      accountLabel: accounts.label,
      accountHandle: accounts.handle,
    })
    .from(mentions)
    .leftJoin(accounts, eq(mentions.accountId, accounts.id))
    .orderBy(desc(mentions.mentionedAt))
    .all();
  return NextResponse.json({ mentions: rows });
}

// Mark all mentions as read for an account
export async function POST(req: Request) {
  try { await requireRole("editor"); } catch (e) { return authErrorResponse(e); }
  const body = (await req.json().catch(() => ({}))) as { accountId?: number; all?: boolean };
  if (body.all) {
    db.update(mentions).set({ isRead: 1 }).run();
  } else if (body.accountId) {
    db.update(mentions).set({ isRead: 1 }).where(eq(mentions.accountId, body.accountId)).run();
  } else {
    return NextResponse.json({ error: "accountId or all required" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
