import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment } from "../types";
import type { AdapterContext } from "../types";
import {
  tiktokBeginOAuth,
  tiktokCompleteOAuth,
  tiktokParseWebhookEvent,
  tiktokPublishVideo,
  tiktokRefresh,
  tiktokVerifyWebhookSignature,
  type TikTokPrivacyLevel,
} from "./client";
import { unsupportedCommentReply } from "../capabilities";

const PRIVACY_LEVELS: readonly TikTokPrivacyLevel[] = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
];

// Direct post is off unless explicitly enabled: TikTok rejects any non-SELF_ONLY
// direct post from a client that has not passed its content-posting audit, so the
// safe default is the inbox/draft flow, which needs no audit.
function tiktokDirectPostConfig(): { directPost: boolean; privacyLevel?: TikTokPrivacyLevel } {
  const directPost = process.env.TIKTOK_DIRECT_POST === "true";
  if (!directPost) return { directPost: false };
  const raw = process.env.TIKTOK_PRIVACY_LEVEL;
  const privacyLevel = PRIVACY_LEVELS.find((p) => p === raw);
  return { directPost: true, privacyLevel };
}

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
    // input.caption already has hashtags folded in by the publish handler.
    const r = await tiktokPublishVideo(
      input.mediaPaths[0]!,
      input.caption,
      input.accessToken,
      tiktokDirectPostConfig(),
    );
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
    return unsupportedCommentReply("tiktok");
  },
  async likeTarget(_id: string, _token: string, _ctx: AdapterContext) { /* noop */ },
  verifyWebhookSignature: tiktokVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = tiktokParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
