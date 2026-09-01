import type { Platform } from "@db/schema";
import { NotImplementedError } from "./types";

/**
 * Which platforms can reply to an existing comment or mention through this app.
 *
 * These maps are the single source of truth: adapters that cannot do the thing
 * throw via the helpers below rather than each hard-coding its own answer, so
 * the map and the runtime behaviour cannot drift apart.
 */
export const SUPPORTS_COMMENT_REPLY: Record<Platform, boolean> = {
  reddit: true,
  mastodon: true,
  facebook: true,
  discord: true,
  youtube: true,
  x: true,
  instagram: true,
  // Needs the w_member_social_feed scope, which is opt-in via LINKEDIN_SCOPES
  // and gated behind Community Management API approval. Marked supported because
  // the call is real: an unapproved app gets a visible 403 rather than silence.
  linkedin: true,

  // No public endpoint for posting a comment. The Content Posting API covers
  // videos and photos only, and the Research API is read-only.
  // https://developers.tiktok.com/products/content-posting-api/
  tiktok: false,
  threads: false,
  bluesky: false,
  pinterest: false,
};

/**
 * Which platforms can add a new top-level comment to one of our own posts —
 * what the first-comment feature needs. Deliberately a separate map: on
 * Instagram and YouTube this is a different endpoint from a reply, and on
 * Discord it needs a post id this app does not currently store.
 */
export const SUPPORTS_TOP_LEVEL_COMMENT: Record<Platform, boolean> = {
  reddit: true,
  mastodon: true,
  facebook: true,
  youtube: true,
  x: true,
  instagram: true,
  linkedin: true,

  // Blocked by the platform post id format, not by the API: publishPost stores a
  // bare message id while the channel id is also required to post into the
  // thread. Tracked separately.
  discord: false,
  tiktok: false,
  threads: false,
  bluesky: false,
  pinterest: false,
};

/**
 * Typed as `never` so an adapter can `return unsupportedCommentReply(...)` and
 * satisfy its Promise<ReplyResult> signature without a dead line after it.
 */
export function unsupportedCommentReply(platform: Platform): never {
  throw new NotImplementedError(`${platform}.postCommentReply`);
}

export function unsupportedTopLevelComment(platform: Platform): never {
  throw new NotImplementedError(`${platform}.postComment`);
}

export function supportsFirstComment(platform: Platform): boolean {
  return SUPPORTS_TOP_LEVEL_COMMENT[platform] ?? false;
}
