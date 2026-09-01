import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { decryptAccountCreds } from "@platforms/creds";
import { db, sqlite } from "@db/client";
import { accounts, posts } from "@db/schema";
import { supportsFirstComment } from "@platforms/capabilities";
import { eq } from "drizzle-orm";
import { complete, fail } from "./claim";

export interface FirstCommentPayload {
  postId: number;
}

/**
 * Posts a post's first comment, as its own job rather than inline in the
 * publish.
 *
 * The publish must not be undone or retried because a follow-up comment
 * failed — the post is already live, and re-running publish would duplicate
 * it. Splitting the two means the comment gets its own retry budget and its
 * own visible failure.
 */
export async function handleFirstComment(payload: FirstCommentPayload, jobId: number): Promise<void> {
  const { postId } = payload;
  const post = db.select().from(posts).where(eq(posts.id, postId)).get();
  if (!post) {
    fail(jobId, `post ${postId} not found`);
    return;
  }
  if (!post.firstComment) {
    complete(jobId);
    return;
  }
  if (post.firstCommentPostedAt) {
    // Already delivered. A retry after a partial failure elsewhere must not
    // post it twice.
    complete(jobId);
    return;
  }
  if (!post.platformPostId) {
    fail(jobId, `post ${postId} has no platform post id yet`);
    return;
  }

  const account = db.select().from(accounts).where(eq(accounts.id, post.accountId)).get();
  if (!account) {
    fail(jobId, `account not found for post ${postId}`);
    return;
  }
  const adapter = getAdapter(account.platform);
  if (!supportsFirstComment(account.platform) || !adapter.postComment) {
    // Terminal: retrying cannot make the platform support it. Recorded on the
    // post so the operator sees why nothing appeared.
    sqlite
      .prepare(`UPDATE posts SET error = ?, updated_at = ? WHERE id = ?`)
      .run(
        `first comment not supported on ${account.platform}`,
        Math.floor(Date.now() / 1000),
        postId,
      );
    complete(jobId);
    return;
  }

  try {
    const creds = decryptAccountCreds(account);
    // postComment, not postCommentReply: this targets the post itself, and on
    // Instagram and YouTube that is a different endpoint entirely.
    await adapter.postComment(
      post.platformPostId,
      post.firstComment,
      typeof creds.accessToken === "string" ? creds.accessToken : "",
      { post, account: { ...account, _creds: creds } },
    );
    sqlite
      .prepare(`UPDATE posts SET first_comment_posted_at = ?, updated_at = ? WHERE id = ?`)
      .run(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), postId);
    complete(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The post itself stays published; only the comment failed, and the error
    // column is where the UI already looks.
    sqlite
      .prepare(`UPDATE posts SET error = ?, updated_at = ? WHERE id = ?`)
      .run(`first comment: ${msg}`, Math.floor(Date.now() / 1000), postId);
    fail(jobId, `first_comment: ${msg}`);
  }
}
