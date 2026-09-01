import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { comments, mentions, engagementActions, accounts } from "@db/schema";
import { requireRole } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { enqueue } from "@/lib/queue/enqueue";

export const runtime = "nodejs";

const Body = z.object({
  targetType: z.enum(["comment", "mention"]),
  targetId: z.number().int().positive(),
  text: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  try { await requireRole("editor"); } catch (e) { return authErrorResponse(e); }
  await runMigrations();
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const { targetType, targetId, text } = parsed.data;

  // Look up the target to find the account_id
  let accountId: number | undefined;
  if (targetType === "comment") {
    const c = db.select({ id: comments.id, accountId: comments.accountId }).from(comments).where(eq(comments.id, targetId)).get();
    if (!c) return NextResponse.json({ error: "comment not found" }, { status: 404 });
    accountId = c.accountId;
  } else {
    const m = db.select({ id: mentions.id, accountId: mentions.accountId }).from(mentions).where(eq(mentions.id, targetId)).get();
    if (!m) return NextResponse.json({ error: "mention not found" }, { status: 404 });
    accountId = m.accountId;
  }

  const account = db.select({ id: accounts.id, status: accounts.status }).from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });
  if (account.status !== "active") return NextResponse.json({ error: "account not active" }, { status: 409 });

  const now = Math.floor(Date.now() / 1000);
  const action = db
    .insert(engagementActions)
    .values({
      kind: "reply",
      targetType,
      targetId,
      replyText: text,
      accountId,
      status: "pending",
      createdAt: now,
    })
    .returning({ id: engagementActions.id })
    .get();
  if (!action) return NextResponse.json({ error: "failed to create action" }, { status: 500 });

  enqueue("post_comment", {
    engagementActionId: action.id,
    targetType,
    targetId,
    text,
  });

  return NextResponse.json({ ok: true, actionId: action.id });
}
