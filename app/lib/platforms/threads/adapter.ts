import type { PlatformAdapter, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment, ReplyResult } from "../types";
import type { AdapterContext } from "../types";
import {
  threadsBeginOAuth,
  threadsCompleteOAuth,
  threadsDeleteThread,
  threadsFetchInsights,
  threadsFetchReplies,
  threadsParseWebhookEvent,
  threadsPublishImage,
  threadsPublishText,
  threadsRefreshToken,
  threadsVerifyWebhookSignature,
} from "./client";

export const threadsAdapter: PlatformAdapter = {
  platform: "threads",
  async beginOAuth() { return threadsBeginOAuth(); },
  async completeOAuth(code: string) { return threadsCompleteOAuth(code); },
  async refresh(creds: DecryptedCreds) { return threadsRefreshToken(creds.accessToken); },
  async publishPost(input: PublishInput, ctx: AdapterContext): Promise<PublishResult> {
    if (!input.accessToken) throw new Error("Threads: no access token");
    const userId = (ctx.account.instanceUrl ?? "").trim();
    if (!userId) throw new Error("Threads: threads user id missing (set instanceUrl column)");
    if (input.mediaPaths && input.mediaPaths.length > 0) {
      const baseUrl = process.env.SOCMED_BASE_URL ?? "http://localhost:3000";
      const url = `${baseUrl}/api/media?path=${encodeURIComponent(input.mediaPaths[0]!)}`;
      const r = await threadsPublishImage(userId, url, input.caption, input.accessToken);
      return { platformPostId: r.id, platformPostUrl: r.url };
    }
    const r = await threadsPublishText(userId, input.caption, input.accessToken, input.linkUrl);
    return { platformPostId: r.id, platformPostUrl: r.url };
  },
  async deletePost(id: string, token: string, _ctx) { return threadsDeleteThread(id, token); },
  async fetchPostMetrics(id: string, token: string, _since: number, _ctx): Promise<AnalyticsSnapshot> {
    const m = await threadsFetchInsights(id, token);
    const engagement = m.views > 0 ? (m.likes + m.replies + m.reposts + m.quotes) / m.views : 0;
    return {
      impressions: m.views,
      reach: m.views,
      likes: m.likes,
      comments: m.replies,
      shares: m.reposts + m.quotes,
      saves: 0,
      videoViews: 0,
      watchTimeMs: 0,
      engagementRate: engagement,
    };
  },
  async fetchMentions(_token: string, _since: number, _ctx) { return { mentions: [] }; },
  async fetchComments(id: string, token: string, since: number, _ctx): Promise<Comment[]> {
    const rs = await threadsFetchReplies(id, token, since);
    return rs.map((r) => ({
      platformCommentId: r.id,
      authorHandle: r.username,
      text: r.text,
      postedAt: Math.floor(Date.parse(r.timestamp) / 1000),
    }));
  },
  async postCommentReply(_id: string, _text: string, _token: string, _ctx): Promise<ReplyResult> {
    throw new Error("Threads reply requires threads user id; configure via /api/accounts with instanceUrl");
  },
  async likeTarget() { /* out of scope for v1 */ },
  verifyWebhookSignature: threadsVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = threadsParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
