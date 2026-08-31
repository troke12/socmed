import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment } from "../types";
import type { AdapterContext } from "../types";
import {
  tiktokBeginOAuth,
  tiktokCompleteOAuth,
  tiktokParseWebhookEvent,
  tiktokPublishVideo,
  tiktokRefresh,
  tiktokVerifyWebhookSignature,
} from "./client";

export const tiktokAdapter: PlatformAdapter = {
  platform: "tiktok",
  async beginOAuth() { return tiktokBeginOAuth(); },
  async completeOAuth(code: string, _redirectUri: string, codeVerifier: string) { return tiktokCompleteOAuth(code, codeVerifier); },
  async refresh(creds: DecryptedCreds) { return tiktokRefresh(creds as EncryptedCreds); },
  async publishPost(input: PublishInput, _ctx: AdapterContext): Promise<PublishResult> {
    if (!input.accessToken) throw new Error("TikTok: no access token");
    if (!input.mediaPaths || input.mediaPaths.length === 0) {
      throw new Error("TikTok requires a video");
    }
    const r = await tiktokPublishVideo(input.mediaPaths[0]!, input.caption, input.accessToken);
    return { platformPostId: r.id, platformPostUrl: r.url };
  },
  async deletePost(_id: string, _token: string, _ctx: AdapterContext) { /* out of scope for v1 */ },
  async fetchPostMetrics(_id: string, _token: string, _since: number, _ctx: AdapterContext): Promise<AnalyticsSnapshot> {
    return { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, videoViews: 0, watchTimeMs: 0, engagementRate: 0 };
  },
  async fetchMentions(_token: string, _since: number, _ctx: AdapterContext) { return { mentions: [] }; },
  async fetchComments(_id: string, _token: string, _since: number, _ctx: AdapterContext): Promise<Comment[]> { return []; },
  async postCommentReply(_id: string, _text: string, _token: string, _ctx: AdapterContext) { return { platformCommentId: "" }; },
  async likeTarget(_id: string, _token: string, _ctx: AdapterContext) { /* noop */ },
  verifyWebhookSignature: tiktokVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = tiktokParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
