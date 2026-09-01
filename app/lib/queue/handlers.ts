import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { decryptAccountCreds } from "@platforms/creds";
import { db, sqlite } from "@db/client";
import { accounts, posts, postMedia, mediaAssets, scheduleRules, type Post, type Account } from "@db/schema";
import type { AccountWithCreds } from "@platforms/types";
import { eq, inArray } from "drizzle-orm";
import { complete, fail } from "./claim";
import { handleFetchMetrics } from "./analytics";
import { handlePostComment } from "./engagement";
import { handleRefreshToken, type RefreshTokenPayload } from "./tokens";

interface PublishPayload {
  postId: number;
}

interface FetchMetricsPayload {
  postId: number;
}

interface PostCommentPayload {
  engagementActionId: number;
  targetType: "comment" | "mention";
  targetId: number;
  text: string;
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

export async function handlePublishPost(payload: PublishPayload, jobId: number): Promise<void> {
  const { postId } = payload;
  const loaded = loadPost(postId);
  if (!loaded) {
    fail(jobId, `post ${postId} not found`);
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
      { post, account: { ...account, _creds: creds } as AccountWithCreds },
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
    complete(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sqlite
      .prepare(`UPDATE posts SET status='failed', error=?, updated_at=? WHERE id=?`)
      .run(msg, Math.floor(Date.now() / 1000), postId);
    fail(jobId, msg);
  }
}

// Creates a new post from a schedule rule's template, then schedules the
// next run (hourly placeholder — cron calc comes in a later milestone).
export async function handleScheduleRule(payload: { ruleId: number }, jobId: number): Promise<void> {
  const { ruleId } = payload;
  const rule = db.select().from(scheduleRules).where(eq(scheduleRules.id, ruleId)).get();
  if (!rule) {
    fail(jobId, `schedule rule ${ruleId} not found`);
    return;
  }
  const account = db.select().from(accounts).where(eq(accounts.id, rule.accountId)).get();
  if (!account) {
    fail(jobId, `schedule rule ${ruleId}: account not found`);
    return;
  }
  const template = rule.templatePostId
    ? db.select().from(posts).where(eq(posts.id, rule.templatePostId)).get()
    : undefined;
  const now = Math.floor(Date.now() / 1000);
  const newPost = db
    .insert(posts)
    .values({
      accountId: rule.accountId,
      kind: template?.kind ?? "text",
      status: "scheduled",
      caption: template?.caption ?? "",
      hashtags: template?.hashtags ?? "",
      linkUrl: template?.linkUrl ?? null,
      scheduledFor: now + 60 * 60,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: posts.id })
    .get();
  if (!newPost) {
    fail(jobId, `schedule rule ${ruleId}: failed to create post`);
    return;
  }
  if (template) {
    const media = db
      .select({ mediaId: postMedia.mediaId })
      .from(postMedia)
      .where(eq(postMedia.postId, template.id))
      .all();
    media.forEach((m, i) => {
      db.insert(postMedia).values({ postId: newPost.id, mediaId: m.mediaId, position: i }).run();
    });
  }
  // Enqueue the publish for the next hour; bump next_run_at.
  const next = now + 60 * 60;
  sqlite.prepare(`UPDATE schedule_rules SET next_run_at = ?, last_run_at = ? WHERE id = ?`).run(next, now, rule.id);
  sqlite.prepare(`INSERT INTO jobs (kind, payload, run_at, max_attempts, created_at) VALUES ('publish_post', ?, ?, 5, ?)`).run(
    JSON.stringify({ postId: newPost.id }),
    next,
    now,
  );
  complete(jobId);
}

export async function handleJob(kind: string, payload: Record<string, unknown>, jobId: number): Promise<void> {
  switch (kind) {
    case "publish_post":
      await handlePublishPost(payload as unknown as PublishPayload, jobId);
      return;
    case "fetch_metrics":
      await handleFetchMetrics(payload as unknown as FetchMetricsPayload, jobId);
      return;
    case "post_comment":
      await handlePostComment(payload as unknown as PostCommentPayload, jobId);
      return;
    case "schedule_rule":
      await handleScheduleRule(payload as unknown as { ruleId: number }, jobId);
      return;
    case "refresh_token":
      await handleRefreshToken(payload as unknown as RefreshTokenPayload, jobId);
      return;
    default:
      fail(jobId, `unknown job kind: ${kind}`);
      return;
  }
}
