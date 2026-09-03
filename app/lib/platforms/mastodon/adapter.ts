import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment, Mention, ReplyResult , AudienceCounts } from "../types";
import type { AdapterContext } from "../types";
import {
  mastodonBeginOAuth,
  mastodonCompleteOAuth,
  mastodonDeleteStatus,
  mastodonFetchContext,
  mastodonFetchNotifications,
  mastodonParseWebhookEvent,
  mastodonPostStatus,
  mastodonFetchAudience,
  mastodonUploadMedia,
  mastodonVerifyWebhookSignature,
} from "./client";

function instanceUrl(ctx: AdapterContext): string {
  const url = (ctx.account.instanceUrl ?? "").trim();
  if (!url) throw new Error("Mastodon: instanceUrl not set on account (e.g. https://mastodon.social)");
  return url;
}

export const mastodonAdapter: PlatformAdapter = {
  platform: "mastodon",
  async beginOAuth() { throw new Error("Mastodon OAuth requires an instance URL — set it in the start route"); },
  async completeOAuth() { throw new Error("Mastodon: completion requires instance URL from state cookie"); },
  async refresh(creds: DecryptedCreds) {
    if (!creds.accessToken) throw new Error("Mastodon: no token");
    return creds as EncryptedCreds;
  },
  async publishPost(input: PublishInput, ctx: AdapterContext): Promise<PublishResult> {
    if (!input.accessToken) throw new Error("Mastodon: no access token");
    const inst = instanceUrl(ctx);
    const mediaIds: string[] = [];
    if (input.mediaPaths) {
      for (const p of input.mediaPaths) {
        mediaIds.push(await mastodonUploadMedia(inst, p, input.accessToken));
      }
    }
    const r = await mastodonPostStatus(inst, input.caption, input.accessToken, { mediaIds });
    return { platformPostId: r.id, platformPostUrl: r.url };
  },
  async deletePost(id: string, token: string, ctx: AdapterContext) {
    return mastodonDeleteStatus(instanceUrl(ctx), id, token);
  },
  async fetchPostMetrics(): Promise<AnalyticsSnapshot> {
    return { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, videoViews: 0, watchTimeMs: 0, engagementRate: 0 };
  },
  async fetchMentions(token: string, since: number, ctx: AdapterContext): Promise<{ mentions: Mention[]; nextCursor?: string }> {
    const inst = instanceUrl(ctx);
    const notes = await mastodonFetchNotifications(inst, token);
    const out: Mention[] = [];
    for (const n of notes) {
      const ts = Math.floor(Date.parse(n.created_at) / 1000);
      if (ts <= since) continue;
      if (n.type !== "mention" && n.type !== "reply") continue;
      out.push({
        platformMentionId: n.id,
        authorHandle: n.account.username,
        authorName: n.account.display_name,
        text: n.status?.content ?? "",
        url: n.status?.id ? `${inst}/@${n.account.username}/${n.status.id}` : undefined,
        mentionedAt: ts,
      });
    }
    return { mentions: out };
  },
  async fetchComments(id: string, token: string, _since: number, ctx: AdapterContext): Promise<Comment[]> {
    const inst = instanceUrl(ctx);
    const c = await mastodonFetchContext(inst, id, token);
    return c.descendants.map((d) => ({
      platformCommentId: d.id,
      authorHandle: d.account.username,
      text: d.content.replace(/<[^>]+>/g, ""),
      postedAt: Math.floor(Date.parse(d.created_at) / 1000),
    }));
  },
  async postCommentReply(id: string, text: string, token: string, ctx: AdapterContext): Promise<ReplyResult> {
    const inst = instanceUrl(ctx);
    const r = await mastodonPostStatus(inst, text, token, { inReplyToId: id });
    return { platformCommentId: r.id };
  },
  // A Mastodon post is a status, so a top-level comment is a status replying to
  // it — the same call as replying to a comment.
  async postComment(platformPostId: string, text: string, token: string, ctx: AdapterContext): Promise<ReplyResult> {
    const inst = instanceUrl(ctx);
    const r = await mastodonPostStatus(inst, text, token, { inReplyToId: platformPostId });
    return { platformCommentId: r.id };
  },
  async likeTarget() { /* out of scope for v1 */ },
  async fetchAudience(accessToken: string, ctx: AdapterContext): Promise<AudienceCounts> {
    return mastodonFetchAudience(instanceUrl(ctx), accessToken);
  },
  verifyWebhookSignature: mastodonVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = mastodonParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};

export { mastodonBeginOAuth, mastodonCompleteOAuth };