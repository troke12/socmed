import type { Platform, Post, Account } from "@db/schema";

export type { Platform };

// Extended context that adapters receive. Includes decrypted creds and instance url.
export type AccountWithCreds = Account & { _creds?: Record<string, unknown> };

export interface AdapterContext {
  post: Post;
  account: AccountWithCreds;
}

export interface EncryptedCreds {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  raw?: Record<string, unknown>;
}

// Decrypted creds are structurally identical to encrypted ones.
export type DecryptedCreds = EncryptedCreds;

export interface PublishInput {
  postId: number;
  caption: string;
  hashtags?: string;
  linkUrl?: string;
  mediaIds?: number[];
  mediaPaths?: string[];
  accessToken?: string;
  rawCreds?: Record<string, unknown>;
  channelId?: string;
}

export interface PublishResult {
  platformPostId: string;
  platformPostUrl: string;
}

export interface AnalyticsSnapshot {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  videoViews: number;
  watchTimeMs: number;
  engagementRate: number;
  raw?: unknown;
}

export interface Mention {
  platformMentionId: string;
  authorHandle: string;
  authorName?: string;
  text: string;
  url?: string;
  mentionedAt: number;
}

export interface Comment {
  platformCommentId: string;
  authorHandle: string;
  text: string;
  postedAt: number;
}

export interface WebhookEvent {
  kind: "mention" | "comment" | "metric" | "other";
  raw: unknown;
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`platform method not implemented: ${method}`);
    this.name = "NotImplementedError";
  }
}

/**
 * Thrown by refresh() on platforms that have no refresh grant at all (Discord bot
 * tokens, Facebook page tokens). Distinct from a normal refresh failure: retrying
 * can never succeed, so the token-refresh handler treats it as terminal and skips
 * the backoff cycle instead of burning five attempts on it.
 */
export class RefreshUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshUnsupportedError";
  }
}

// Reply result; many platforms return {id} and we wrap as {platformCommentId: id}
export interface ReplyResult {
  platformCommentId: string;
}

export interface PlatformAdapter {
  readonly platform: Platform;

  beginOAuth?(redirectUri: string): Promise<{ authUrl: string; state: string }>;
  completeOAuth?(code: string, redirectUri: string, codeVerifier: string): Promise<EncryptedCreds>;
  refresh?(creds: DecryptedCreds): Promise<EncryptedCreds>;

  publishPost(input: PublishInput, ctx: AdapterContext): Promise<PublishResult>;
  deletePost(platformPostId: string, accessToken: string, ctx: AdapterContext): Promise<void>;

  fetchPostMetrics(platformPostId: string, accessToken: string, since: number, ctx: AdapterContext): Promise<AnalyticsSnapshot>;
  fetchMentions(
    accessToken: string,
    since: number,
    ctx: AdapterContext,
  ): Promise<{ mentions: Mention[]; nextCursor?: string }>;
  fetchComments(platformPostId: string, accessToken: string, since: number, ctx: AdapterContext): Promise<Comment[]>;

  postCommentReply(platformCommentId: string, text: string, accessToken: string, ctx: AdapterContext): Promise<ReplyResult>;
  likeTarget(platformTargetId: string, accessToken: string, ctx: AdapterContext): Promise<void>;

  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean;
  parseWebhookEvent(rawBody: string, headers: Record<string, string>): WebhookEvent[];
}
