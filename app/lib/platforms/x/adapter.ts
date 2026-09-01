import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment, WebhookEvent , ReplyResult } from "../types";
import type { AdapterContext } from "../types";
import {
  xBeginOAuth,
  xCompleteOAuth,
  xDeleteTweet,
  xFetchMetrics,
  xParseWebhookEvent,
  xPublishTweet,
  xRefresh,
  xVerifyWebhookSignature,
  xUploadMedia,
} from "./client";
import { xReplyToTweet } from "./client";

export const xAdapter: PlatformAdapter = {
  platform: "x",
  async beginOAuth() { return xBeginOAuth(); },
  async completeOAuth(code: string, _redirectUri: string, codeVerifier: string) { return xCompleteOAuth(code, codeVerifier); },
  async refresh(creds: DecryptedCreds) { return xRefresh(creds as EncryptedCreds); },
  async publishPost(input: PublishInput, _ctx: AdapterContext): Promise<PublishResult> {
    if (!input.accessToken) throw new Error("X: no access token");
    if (!input.mediaPaths || input.mediaPaths.length === 0) {
      const r = await xPublishTweet(input.caption, [], input.accessToken);
      return { platformPostId: r.id, platformPostUrl: r.url };
    }
    const mediaIds: string[] = [];
    for (const p of input.mediaPaths) {
      mediaIds.push(await xUploadMedia(p, input.accessToken));
    }
    const r = await xPublishTweet(input.caption, mediaIds, input.accessToken);
    return { platformPostId: r.id, platformPostUrl: r.url };
  },
  async deletePost(id: string, token: string) { return xDeleteTweet(id, token); },
  async fetchPostMetrics(id: string, token: string, _since: number, _ctx): Promise<AnalyticsSnapshot> {
    const m = await xFetchMetrics(id, token);
    const likes = m.likes ?? 0;
    const replies = m.replies ?? 0;
    const shares = (m.retweets ?? 0) + (m.quotes ?? 0);
    const videoViews = m.video_views ?? 0;
    const impressions = m.impressions ?? 0;
    const engagement = impressions > 0 ? (likes + replies + shares) / impressions : 0;
    return {
      impressions,
      reach: impressions,
      likes,
      comments: replies,
      shares,
      saves: m.bookmarks ?? 0,
      videoViews,
      watchTimeMs: 0,
      engagementRate: engagement,
    };
  },
  async fetchMentions() { return { mentions: [] }; },
  async fetchComments(): Promise<Comment[]> { return []; },
  async postCommentReply(platformCommentId: string, text: string, accessToken: string): Promise<ReplyResult> {
    // On X a comment is a post, so replying to a comment and commenting on a
    // post are the same request with a different target id.
    const r = await xReplyToTweet(platformCommentId, text, accessToken);
    return { platformCommentId: r.id };
  },
  async postComment(platformPostId: string, text: string, accessToken: string): Promise<ReplyResult> {
    const r = await xReplyToTweet(platformPostId, text, accessToken);
    return { platformCommentId: r.id };
  },
  async likeTarget() { /* noop */ },
  verifyWebhookSignature: xVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers): WebhookEvent[] => {
    const { challenge } = xParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
