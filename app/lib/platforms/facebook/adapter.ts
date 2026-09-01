import type { PlatformAdapter, PublishInput, PublishResult, AnalyticsSnapshot, Comment, ReplyResult } from "../types";
import type { AdapterContext } from "../types";
import { RefreshUnsupportedError } from "../types";
import {
  facebookBeginOAuth,
  facebookCompleteOAuth,
  facebookDeletePost,
  facebookFetchComments,
  facebookFetchPostInsights,
  facebookParseWebhookEvent,
  facebookPostPhotoToPage,
  facebookPostToPage,
  facebookReplyToComment,
  facebookVerifyWebhookSignature,
} from "./client";

export const facebookAdapter: PlatformAdapter = {
  platform: "facebook",
  async beginOAuth() { return facebookBeginOAuth(); },
  async completeOAuth(code: string) { return facebookCompleteOAuth(code); },
  async refresh(): Promise<never> {
    throw new RefreshUnsupportedError("Facebook: re-run OAuth to get a new page access token");
  },
  async publishPost(input: PublishInput, ctx: AdapterContext): Promise<PublishResult> {
    if (!input.accessToken) throw new Error("Facebook: no access token");
    const pageId = (ctx.account.instanceUrl ?? "").trim();
    if (!pageId) throw new Error("Facebook: page id missing (set instanceUrl column to page id)");
    if (input.mediaPaths && input.mediaPaths.length > 0) {
      const r = await facebookPostPhotoToPage(pageId, input.accessToken, input.mediaPaths[0]!, input.caption);
      return { platformPostId: r.id, platformPostUrl: r.url };
    }
    const r = await facebookPostToPage(pageId, input.accessToken, input.caption, input.linkUrl);
    return { platformPostId: r.id, platformPostUrl: r.url };
  },
  async deletePost(id: string, token: string, _ctx) { return facebookDeletePost(id, token); },
  async fetchPostMetrics(id: string, token: string, _since: number, _ctx): Promise<AnalyticsSnapshot> {
    const m = await facebookFetchPostInsights(id, token);
    return {
      impressions: m.impressions,
      reach: m.reach,
      likes: m.reactions,
      comments: m.comments,
      shares: m.shares,
      saves: 0,
      videoViews: 0,
      watchTimeMs: 0,
      engagementRate: m.impressions > 0 ? m.engaged / m.impressions : 0,
    };
  },
  async fetchMentions(_token: string, _since: number, _ctx) { return { mentions: [] }; },
  async fetchComments(id: string, token: string, since: number, _ctx): Promise<Comment[]> {
    const cs = await facebookFetchComments(id, token, since);
    return cs.map((c) => ({
      platformCommentId: c.id,
      authorHandle: c.from_name,
      text: c.message,
      postedAt: Math.floor(Date.parse(c.created_time) / 1000),
    }));
  },
  async postCommentReply(id: string, text: string, token: string, _ctx): Promise<ReplyResult> {
    const r = await facebookReplyToComment(id, text, token);
    return { platformCommentId: r.id };
  },
  // Graph's /{object-id}/comments edge accepts a post id as readily as a
  // comment id, so the same call serves both.
  async postComment(platformPostId: string, text: string, token: string): Promise<ReplyResult> {
    const r = await facebookReplyToComment(platformPostId, text, token);
    return { platformCommentId: r.id };
  },
  async likeTarget() { /* not exposed for pages here */ },
  verifyWebhookSignature: facebookVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = facebookParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
