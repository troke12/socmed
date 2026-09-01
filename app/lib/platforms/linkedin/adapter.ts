import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment } from "../types";
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
import { unsupportedCommentReply } from "../capabilities";

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
  async postCommentReply() {
    // Returned a fake success before, which marked replies as sent that were
    // never delivered. See #32.
    return unsupportedCommentReply("linkedin");
  },
  async likeTarget() { /* noop */ },
  verifyWebhookSignature: linkedinVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = linkedinParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
