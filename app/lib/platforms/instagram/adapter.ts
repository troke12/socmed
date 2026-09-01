import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment , ReplyResult } from "../types";
import type { AdapterContext } from "../types";
import {
  instagramBeginOAuth,
  instagramCompleteOAuth,
  instagramParseWebhookEvent,
  instagramPublishMedia,
  instagramRefresh,
  instagramVerifyWebhookSignature,
} from "./client";
import { instagramReplyToComment, instagramCommentOnMedia } from "./client";

export const instagramAdapter: PlatformAdapter = {
  platform: "instagram",
  async beginOAuth() { return instagramBeginOAuth(); },
  async completeOAuth(code: string) { return instagramCompleteOAuth(code); },
  async refresh(creds: DecryptedCreds) { return instagramRefresh(creds as EncryptedCreds); },
  async publishPost(input: PublishInput, _ctx: AdapterContext): Promise<PublishResult> {
    if (!input.accessToken) throw new Error("Instagram: no access token");
    if (!input.mediaPaths || input.mediaPaths.length === 0) {
      throw new Error("Instagram requires at least one media file");
    }
    const r = await instagramPublishMedia(input.caption, input.mediaPaths[0]!, input.accessToken);
    return { platformPostId: r.id, platformPostUrl: r.url };
  },
  async deletePost(_id: string, _token: string, _ctx: AdapterContext) { /* out of scope for v1 */ },
  async fetchPostMetrics(_id: string, _token: string, _since: number, _ctx: AdapterContext): Promise<AnalyticsSnapshot> {
    return { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, videoViews: 0, watchTimeMs: 0, engagementRate: 0 };
  },
  async fetchMentions(_token: string, _since: number, _ctx: AdapterContext) { return { mentions: [] }; },
  async fetchComments(_id: string, _token: string, _since: number, _ctx: AdapterContext): Promise<Comment[]> { return []; },
  async postCommentReply(platformCommentId: string, text: string, accessToken: string): Promise<ReplyResult> {
    const r = await instagramReplyToComment(platformCommentId, text, accessToken);
    return { platformCommentId: r.id };
  },
  async postComment(platformPostId: string, text: string, accessToken: string): Promise<ReplyResult> {
    // Different edge from a reply — this is the hashtags-in-the-first-comment
    // case the feature exists for.
    const r = await instagramCommentOnMedia(platformPostId, text, accessToken);
    return { platformCommentId: r.id };
  },
  async likeTarget(_id: string, _token: string, _ctx: AdapterContext) { /* noop */ },
  verifyWebhookSignature: instagramVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = instagramParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
