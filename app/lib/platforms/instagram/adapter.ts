import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment } from "../types";
import type { AdapterContext } from "../types";
import {
  instagramBeginOAuth,
  instagramCompleteOAuth,
  instagramParseWebhookEvent,
  instagramPublishMedia,
  instagramRefresh,
  instagramVerifyWebhookSignature,
} from "./client";
import { unsupportedCommentReply } from "../capabilities";

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
  async postCommentReply() {
    // Returned a fake success before, which marked replies as sent that were
    // never delivered. See #32.
    return unsupportedCommentReply("instagram");
  },
  async likeTarget(_id: string, _token: string, _ctx: AdapterContext) { /* noop */ },
  verifyWebhookSignature: instagramVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = instagramParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
