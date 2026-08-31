import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { comments, posts, accounts } from "@db/schema";
import { requireSession } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET() {
  try { await requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  await runMigrations();
  const rows = db
    .select({
      id: comments.id,
      postId: comments.postId,
      accountId: comments.accountId,
      platform: comments.platform,
      platformCommentId: comments.platformCommentId,
      authorHandle: comments.authorHandle,
      text: comments.text,
      postedAt: comments.postedAt,
      isReplied: comments.isReplied,
      replyId: comments.replyId,
      postCaption: posts.caption,
      postUrl: posts.platformPostUrl,
      accountLabel: accounts.label,
      accountHandle: accounts.handle,
    })
    .from(comments)
    .leftJoin(posts, eq(comments.postId, posts.id))
    .leftJoin(accounts, eq(comments.accountId, accounts.id))
    .orderBy(desc(comments.postedAt))
    .all();
  return NextResponse.json({ comments: rows });
}
