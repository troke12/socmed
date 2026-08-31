import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { decryptJson, unpack } from "@platforms/crypto";
import { db, sqlite } from "@db/client";
import { comments, mentions, engagementActions, accounts, posts, type Post } from "@db/schema";
import { eq } from "drizzle-orm";
import { complete, fail } from "./claim";

interface PostCommentPayload {
  engagementActionId: number;
  targetType: "comment" | "mention";
  targetId: number;
  text: string;
}

export async function handlePostComment(payload: PostCommentPayload): Promise<void> {
  const { engagementActionId, targetType, targetId, text } = payload;
  const action = db.select().from(engagementActions).where(eq(engagementActions.id, engagementActionId)).get();
  if (!action) {
    fail(engagementActionId, `engagement action ${engagementActionId} not found`);
    return;
  }
  const account = db.select().from(accounts).where(eq(accounts.id, action.accountId)).get();
  if (!account) {
    fail(engagementActionId, "account not found");
    return;
  }

  let platformCommentId: string | undefined;
  let post: Post | undefined;
  if (targetType === "comment") {
    const c = db.select().from(comments).where(eq(comments.id, targetId)).get();
    if (!c) { fail(engagementActionId, "comment not found"); return; }
    platformCommentId = c.platformCommentId;
    const p = db.select().from(posts).where(eq(posts.id, c.postId)).get();
    post = p;
  } else {
    const m = db.select().from(mentions).where(eq(mentions.id, targetId)).get();
    if (!m) { fail(engagementActionId, "mention not found"); return; }
    platformCommentId = m.platformMentionId;
    // For mentions, we still need a post context for some platforms; pick the most recent published post for this account.
    const p = db
      .select()
      .from(posts)
      .where(eq(posts.accountId, account.id))
      .orderBy(posts.publishedAt)
      .get();
    post = p;
  }

  if (!platformCommentId) {
    fail(engagementActionId, "platform comment id missing");
    return;
  }
  if (!post) {
    // For mentions, we still need a Post for ctx; if none, create a synthetic minimal one
    post = {
      id: 0,
      accountId: account.id,
      kind: "text",
      status: "published",
      caption: "",
      hashtags: "",
      linkUrl: null,
      scheduledFor: null,
      publishedAt: Math.floor(Date.now() / 1000),
      platformPostId: null,
      platformPostUrl: null,
      error: null,
      attemptCount: 0,
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    } as Post;
  }

  const creds = decryptAccountCreds(account);
  const adapter = getAdapter(account.platform);

  try {
    const result = await adapter.postCommentReply(
      platformCommentId,
      text,
      typeof creds.accessToken === "string" ? creds.accessToken : "",
      { post, account: { ...account, _creds: creds } },
    );
    const now = Math.floor(Date.now() / 1000);
    sqlite.prepare(`UPDATE engagement_actions SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?`).run(now, engagementActionId);
    if (targetType === "comment") {
      sqlite.prepare(`UPDATE comments SET is_replied = 1, reply_id = ? WHERE id = ?`).run(result.platformCommentId, targetId);
    }
    complete(engagementActionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sqlite.prepare(`UPDATE engagement_actions SET status = 'failed', error = ? WHERE id = ?`).run(msg, engagementActionId);
    fail(engagementActionId, msg);
  }
}

function decryptAccountCreds(account: typeof accounts.$inferSelect): Record<string, unknown> {
  const ct = unpack(account.encryptedCreds, account.credsIv, account.credsTag);
  return decryptJson<Record<string, unknown>>(account.id, ct);
}
