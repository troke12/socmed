import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment , ReplyResult } from "../types";
import type { AdapterContext } from "../types";
import {
  linkedinBeginOAuth,
  linkedinCompleteOAuth,
  linkedinDeletePost,
  linkedinFetchMetrics,
  linkedinParseWebhookEvent,
  linkedinPublishPost,
  linkedinRefresh,
  linkedinVerifyWebhookSignature,
} from "./client";
import { linkedinCreateComment } from "./client";

export const linkedinAdapter: PlatformAdapter = {
  platform: "linkedin",
  async beginOAuth() { return linkedinBeginOAuth(); },
  async completeOAuth(code: string) { return linkedinCompleteOAuth(code); },
  async refresh(creds: DecryptedCreds) { return linkedinRefresh(creds as EncryptedCreds); },
  async publishPost(input: PublishInput, _ctx: AdapterContext): Promise<PublishResult> {
    if (!input.accessToken) throw new Error("LinkedIn: no access token");
    const r = await linkedinPublishPost(input.caption, input.mediaPaths ?? [], input.accessToken);
    return { platformPostId: r.id, platformPostUrl: r.url };
  },
  async deletePost(id: string, token: string) { return linkedinDeletePost(id, token); },
  async fetchPostMetrics(id: string, token: string, _since: number, _ctx): Promise<AnalyticsSnapshot> {
    const m = await linkedinFetchMetrics(id, token);
    return {
      impressions: m.impressions,
      reach: 0,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      saves: 0,
      videoViews: 0,
      watchTimeMs: 0,
      engagementRate: 0,
    };
  },
  async fetchMentions() { return { mentions: [] }; },
  async fetchComments(): Promise<Comment[]> { return []; },
  async postCommentReply(platformCommentId: string, text: string, accessToken: string, ctx: AdapterContext): Promise<ReplyResult> {
    // The target in the URL is the thread the comment lives on, and
    // parentComment is what makes this a reply rather than a new comment.
    const threadUrn = ctx.post.platformPostId ?? platformCommentId;
    const r = await linkedinCreateComment(threadUrn, text, accessToken, {
      parentComment: platformCommentId,
    });
    return { platformCommentId: r.id };
  },
  async postComment(platformPostId: string, text: string, accessToken: string): Promise<ReplyResult> {
    const r = await linkedinCreateComment(platformPostId, text, accessToken);
    return { platformCommentId: r.id };
  },
  async likeTarget() { /* noop */ },
  verifyWebhookSignature: linkedinVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = linkedinParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
