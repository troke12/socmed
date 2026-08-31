import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { decryptJson, unpack } from "@platforms/crypto";
import { db, sqlite } from "@db/client";
import { accounts, posts, postMedia, mediaAssets, type Post, type Account } from "@db/schema";
import { eq, inArray } from "drizzle-orm";
import { complete, fail } from "./claim";

interface PublishPayload {
  postId: number;
}

function loadPost(postId: number): { post: Post; account: Account; mediaIds: number[] } | null {
  const post = db.select().from(posts).where(eq(posts.id, postId)).get();
  if (!post) return null;
  const account = db.select().from(accounts).where(eq(accounts.id, post.accountId)).get();
  if (!account) return null;
  const links = db
    .select({ mediaId: postMedia.mediaId })
    .from(postMedia)
    .where(eq(postMedia.postId, postId))
    .all();
  const mediaIds = links.map((l) => l.mediaId).sort((a, b) => a - b);
  return { post, account, mediaIds };
}

function loadMediaPaths(mediaIds: number[]): string[] {
  if (mediaIds.length === 0) return [];
  const rows = db
    .select({ path: mediaAssets.path })
    .from(mediaAssets)
    .where(inArray(mediaAssets.id, mediaIds))
    .all();
  // Resolve to absolute paths via the uploads dir
  const uploadsDir = process.env.SOCMED_UPLOADS_DIR ?? "./data/uploads";
  return rows.map((r) => `${uploadsDir}/${r.path}`);
}

function decryptAccountCreds(account: Account): Record<string, unknown> {
  const ct = unpack(account.encryptedCreds, account.credsIv, account.credsTag);
  return decryptJson<Record<string, unknown>>(account.id, ct);
}

export async function handlePublishPost(payload: PublishPayload): Promise<void> {
  const { postId } = payload;
  const loaded = loadPost(postId);
  if (!loaded) {
    fail(postId, `post ${postId} not found`);
    return;
  }
  const { post, account } = loaded;
  const mediaIds = loaded.mediaIds;
  const mediaPaths = loadMediaPaths(mediaIds);

  sqlite.prepare(`UPDATE posts SET status = 'publishing', updated_at = ? WHERE id = ?`).run(
    Math.floor(Date.now() / 1000),
    postId,
  );

  try {
    const creds = decryptAccountCreds(account);
    const adapter = getAdapter(account.platform);
    const fullText = [post.caption, post.hashtags].filter(Boolean).join("\n\n");
    const result = await adapter.publishPost(
      {
        postId: post.id,
        caption: fullText,
        hashtags: post.hashtags,
        linkUrl: post.linkUrl ?? undefined,
        mediaIds,
        mediaPaths,
        accessToken: typeof creds.accessToken === "string" ? creds.accessToken : undefined,
        rawCreds: creds,
        // Persist the channel ID if user set one on the post (e.g. Discord target channel)
        channelId: undefined,
      },
      { post, account: { ...account, _creds: creds } },
    );
    sqlite
      .prepare(
        `UPDATE posts SET status='published', published_at=?, platform_post_id=?, platform_post_url=?, error=NULL, updated_at=? WHERE id=?`,
      )
      .run(
        Math.floor(Date.now() / 1000),
        result.platformPostId,
        result.platformPostUrl,
        Math.floor(Date.now() / 1000),
        postId,
      );
    complete(postId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sqlite
      .prepare(`UPDATE posts SET status='failed', error=?, updated_at=? WHERE id=?`)
      .run(msg, Math.floor(Date.now() / 1000), postId);
    fail(postId, msg);
  }
}

export async function handleJob(kind: string, payload: Record<string, unknown>, jobId: number): Promise<void> {
  switch (kind) {
    case "publish_post":
      await handlePublishPost(payload as unknown as PublishPayload);
      return;
    default:
      fail(jobId, `unknown job kind: ${kind}`);
      return;
  }
}
