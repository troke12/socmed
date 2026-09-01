import type { Platform } from "@db/schema";
import { NotImplementedError } from "./types";

/**
 * Which platforms can actually post a comment reply through this app.
 *
 * This map is the single source of truth: the adapters that cannot do it throw
 * via `assertCommentReplySupported` below rather than each hard-coding their
 * own answer, so the map and the runtime behaviour cannot drift apart.
 *
 * The four false entries that used to return a fake success — x, instagram,
 * linkedin, tiktok — are tracked in #32. Implementing them for real needs
 * per-platform endpoints and OAuth scopes the current flow may not request.
 */
export const SUPPORTS_COMMENT_REPLY: Record<Platform, boolean> = {
  reddit: true,
  mastodon: true,
  facebook: true,
  discord: true,
  youtube: true,

  x: false,
  instagram: false,
  linkedin: false,
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

/**
 * A first comment is just a reply addressed at the post itself, so it needs the
 * same capability. Named separately because that is how the UI talks about it.
 */
export function supportsFirstComment(platform: Platform): boolean {
  return SUPPORTS_COMMENT_REPLY[platform] ?? false;
}
