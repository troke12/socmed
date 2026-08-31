import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment, ReplyResult } from "../types";
import type { AdapterContext } from "../types";
import {
  pinterestBeginOAuth,
  pinterestCompleteOAuth,
  pinterestCreatePin,
  pinterestDeletePin,
  pinterestFetchPinAnalytics,
  pinterestParseWebhookEvent,
  pinterestRefresh,
  pinterestVerifyWebhookSignature,
} from "./client";

export const pinterestAdapter: PlatformAdapter = {
  platform: "pinterest",
  async beginOAuth() { return pinterestBeginOAuth(); },
  async completeOAuth(code: string) { return pinterestCompleteOAuth(code); },
  async refresh(creds: DecryptedCreds) { return pinterestRefresh(creds as EncryptedCreds); },
  async publishPost(input: PublishInput, ctx: AdapterContext): Promise<PublishResult> {
    if (!input.accessToken) throw new Error("Pinterest: no access token");
    const boardId = (ctx.account.instanceUrl ?? "").trim();
    if (!boardId) throw new Error("Pinterest: board id missing (set instanceUrl column)");
    if (!input.mediaPaths || input.mediaPaths.length === 0) throw new Error("Pinterest requires an image");
    const baseUrl = process.env.SOCMED_BASE_URL ?? "http://localhost:3000";
    const imageUrl = `${baseUrl}/api/media?path=${encodeURIComponent(input.mediaPaths[0]!)}`;
    const r = await pinterestCreatePin(boardId, input.caption.slice(0, 100), input.caption, imageUrl, input.linkUrl, input.accessToken);
    return { platformPostId: r.id, platformPostUrl: r.url };
  },
  async deletePost(id: string, token: string, _ctx) { return pinterestDeletePin(id, token); },
  async fetchPostMetrics(id: string, token: string, _since: number, _ctx): Promise<AnalyticsSnapshot> {
    const m = await pinterestFetchPinAnalytics(id, token);
    return {
      impressions: m.impressions,
      reach: m.impressions,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: m.saves,
      videoViews: 0,
      watchTimeMs: 0,
      engagementRate: m.impressions > 0 ? (m.saves + m.clicks) / m.impressions : 0,
    };
  },
  async fetchMentions(_token: string, _since: number, _ctx) { return { mentions: [] }; },
  async fetchComments(_id: string, _token: string, _since: number, _ctx): Promise<Comment[]> { return []; },
  async postCommentReply(_id: string, _text: string, _token: string, _ctx): Promise<ReplyResult> {
    throw new Error("Pinterest comments via API are not supported for app pins");
  },
  async likeTarget(_id: string, _token: string, _ctx) { /* noop */ },
  verifyWebhookSignature: pinterestVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = pinterestParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
