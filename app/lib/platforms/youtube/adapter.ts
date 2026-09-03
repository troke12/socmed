import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment, ReplyResult , AudienceCounts } from "../types";
import type { AdapterContext } from "../types";
import {
  youtubeBeginOAuth,
  youtubeCompleteOAuth,
  youtubeDeleteVideo,
  youtubeFetchComments,
  youtubeFetchVideoStats,
  youtubeParseWebhookEvent,
  youtubeRefresh,
  youtubeReplyToComment,
  youtubeCommentOnVideo,
  youtubeFetchAudience,
  youtubeUploadVideo,
  youtubeVerifyWebhookSignature,
} from "./client";

export const youtubeAdapter: PlatformAdapter = {
  platform: "youtube",
  async beginOAuth() { return youtubeBeginOAuth(); },
  async completeOAuth(code: string, _redirectUri: string, codeVerifier: string) { return youtubeCompleteOAuth(code, codeVerifier); },
  async refresh(creds: DecryptedCreds) { return youtubeRefresh(creds as EncryptedCreds); },
  async publishPost(input: PublishInput, _ctx: AdapterContext): Promise<PublishResult> {
    if (!input.accessToken) throw new Error("YouTube: no access token");
    if (!input.mediaPaths || input.mediaPaths.length === 0) throw new Error("YouTube requires a video file");
    const tags = (input.hashtags ?? "").split(/\s+/).filter((t) => t.startsWith("#")).map((t) => t.slice(1));
    const title = input.caption.split("\n")[0]?.slice(0, 100) ?? "Untitled";
    const r = await youtubeUploadVideo(input.mediaPaths[0]!, title, input.caption, input.accessToken, tags);
    return { platformPostId: r.id, platformPostUrl: r.url };
  },
  async deletePost(id: string, token: string, _ctx) { return youtubeDeleteVideo(id, token); },
  async fetchPostMetrics(id: string, token: string, _since: number, _ctx): Promise<AnalyticsSnapshot> {
    const s = await youtubeFetchVideoStats(id, token);
    return {
      impressions: s.views,
      reach: s.views,
      likes: s.likes,
      comments: s.comments,
      shares: 0,
      saves: 0,
      videoViews: s.views,
      watchTimeMs: 0,
      engagementRate: s.views > 0 ? (s.likes + s.comments) / s.views : 0,
    };
  },
  async fetchMentions(_token: string, _since: number, _ctx) { return { mentions: [] }; },
  async fetchComments(id: string, token: string, _since: number, _ctx): Promise<Comment[]> {
    const cs = await youtubeFetchComments(id, token);
    return cs.map((c) => ({
      platformCommentId: c.id,
      authorHandle: c.authorDisplayName,
      text: c.textDisplay,
      postedAt: Math.floor(Date.parse(c.publishedAt) / 1000),
    }));
  },
  async postCommentReply(id: string, text: string, token: string, _ctx): Promise<ReplyResult> {
    const r = await youtubeReplyToComment(id, text, token);
    return { platformCommentId: r.id };
  },
  async postComment(platformPostId: string, text: string, token: string): Promise<ReplyResult> {
    // Not youtubeReplyToComment: comments.insert needs a parent comment id and
    // cannot open a new thread on a video.
    const r = await youtubeCommentOnVideo(platformPostId, text, token);
    return { platformCommentId: r.id };
  },
  async likeTarget() { /* out of scope for v1 */ },
  async fetchAudience(accessToken: string): Promise<AudienceCounts> {
    return youtubeFetchAudience(accessToken);
  },
  verifyWebhookSignature: youtubeVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = youtubeParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
