import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment, ReplyResult } from "../types";
import type { AdapterContext } from "../types";
import {
  redditBeginOAuth,
  redditCompleteOAuth,
  redditDelete,
  redditFetchPostComments,
  redditParseWebhookEvent,
  redditRefresh,
  redditReply,
  redditSubmit,
  redditVerifyWebhookSignature,
} from "./client";

export const redditAdapter: PlatformAdapter = {
  platform: "reddit",
  async beginOAuth() { return redditBeginOAuth(); },
  async completeOAuth(code: string) { return redditCompleteOAuth(code); },
  async refresh(creds: DecryptedCreds) { return redditRefresh(creds as EncryptedCreds); },
  async publishPost(input: PublishInput, ctx: AdapterContext): Promise<PublishResult> {
    if (!input.accessToken) throw new Error("Reddit: no access token");
    const subreddit = (ctx.account.instanceUrl ?? "").trim().replace(/^\/?r\//, "");
    if (!subreddit) throw new Error("Reddit: subreddit missing (set instanceUrl column, e.g. 'marketing')");
    const title = input.caption.split("\n")[0]?.slice(0, 300) ?? "Untitled";
    const body = input.caption.split("\n").slice(1).join("\n").trim() || title;
    const r = await redditSubmit(subreddit, title, body, input.accessToken, input.linkUrl ? "link" : "self", input.linkUrl);
    return { platformPostId: r.name, platformPostUrl: r.url };
  },
  async deletePost(name: string, token: string, _ctx) { return redditDelete(name, token); },
  async fetchPostMetrics(_id: string, _token: string, _since: number, _ctx): Promise<AnalyticsSnapshot> {
    return { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, videoViews: 0, watchTimeMs: 0, engagementRate: 0 };
  },
  async fetchMentions(_token: string, _since: number, _ctx) { return { mentions: [] }; },
  async fetchComments(id: string, token: string, _since: number, _ctx): Promise<Comment[]> {
    const parts = id.includes("|") ? id.split("|") : ["", id.replace("t3_", "")];
    const [subreddit, postId] = parts;
    if (!subreddit || !postId) return [];
    const cs = await redditFetchPostComments(subreddit, postId, token);
    return cs.map((c) => ({
      platformCommentId: c.id,
      authorHandle: c.author,
      text: c.body,
      postedAt: c.created_utc,
    }));
  },
  async postCommentReply(id: string, text: string, token: string, _ctx): Promise<ReplyResult> {
    const r = await redditReply(id, text, token);
    return { platformCommentId: r.id };
  },
  async likeTarget() { /* noop */ },
  verifyWebhookSignature: redditVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = redditParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
