import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment, Mention, ReplyResult } from "../types";
import type { AdapterContext } from "../types";
import {
  blueskyCreatePost,
  blueskyDeletePost,
  blueskyListNotifications,
  blueskyParseWebhookEvent,
  blueskyRefreshSession,
  blueskyUploadBlob,
  blueskyVerifyWebhookSignature,
  getBlueskyPDS,
} from "./client";

function asCreds(rawCreds: Record<string, unknown> | undefined): { accessToken: string; refreshToken?: string; did: string; pds: string } {
  if (!rawCreds) throw new Error("Bluesky: no creds");
  const raw = (rawCreds.raw as { did?: string; pdsUrl?: string } | undefined) ?? {};
  const did = raw.did;
  if (!did) throw new Error("Bluesky: DID missing from creds (re-add the account)");
  const pds = getBlueskyPDS(rawCreds);
  return {
    accessToken: String(rawCreds.accessToken),
    refreshToken: rawCreds.refreshToken as string | undefined,
    did,
    pds,
  };
}

export const blueskyAdapter: PlatformAdapter = {
  platform: "bluesky",
  async beginOAuth() { throw new Error("Bluesky uses app passwords, not OAuth — add on Accounts page"); },
  async completeOAuth() { throw new Error("Bluesky uses app passwords, not OAuth"); },
  async refresh(creds: DecryptedCreds) {
    const c = asCreds(creds as unknown as Record<string, unknown>);
    if (!c.refreshToken) throw new Error("Bluesky: no refresh token");
    const r = await blueskyRefreshSession(c.refreshToken, c.pds);
    return { accessToken: r.accessJwt, refreshToken: r.refreshJwt } as EncryptedCreds;
  },
  async publishPost(input: PublishInput, ctx: AdapterContext): Promise<PublishResult> {
    if (!input.rawCreds) throw new Error("Bluesky: no creds");
    const c = asCreds(input.rawCreds);
    let embed: { ref: { $link: string }; mimeType: string; size: number } | undefined;
    if (input.mediaPaths && input.mediaPaths.length > 0) {
      embed = await blueskyUploadBlob(c.pds, c.accessToken, input.mediaPaths[0]!);
    }
    const r = await blueskyCreatePost(c.pds, c.accessToken, c.did, input.caption, { embed });
    return { platformPostId: r.uri, platformPostUrl: r.url };
  },
  async deletePost(uri: string, _token: string, ctx: AdapterContext) {
    // Re-decrypt creds via the account row (the queue handler passes rawCreds on input;
    // for delete we use ctx.account — the worker will populate it).
    const rawCreds = (ctx.account as { _creds?: Record<string, unknown> })._creds;
    const c = asCreds(rawCreds);
    const rkey = uri.split("/").pop();
    if (!rkey) throw new Error("Bluesky: invalid uri");
    return blueskyDeletePost(c.pds, c.accessToken, c.did, rkey);
  },
  async fetchPostMetrics(): Promise<AnalyticsSnapshot> {
    return { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, videoViews: 0, watchTimeMs: 0, engagementRate: 0 };
  },
  async fetchMentions(_token: string, since: number, ctx: AdapterContext): Promise<{ mentions: Mention[]; nextCursor?: string }> {
    const rawCreds = (ctx.account as { _creds?: Record<string, unknown> })._creds;
    const c = asCreds(rawCreds);
    const sinceIso = since > 0 ? new Date(since * 1000).toISOString() : undefined;
    const notes = await blueskyListNotifications(c.pds, c.accessToken, sinceIso);
    return {
      mentions: notes
        .filter((n) => n.reason === "mention" || n.reason === "reply")
        .map((n) => ({
          platformMentionId: n.uri,
          authorHandle: n.author.handle,
          authorName: n.author.handle,
          text: n.record.text,
          mentionedAt: Math.floor(Date.parse(n.indexedAt) / 1000),
          url: `https://bsky.app/profile/${n.author.handle}/post/${n.uri.split("/").pop()}`,
        })),
    };
  },
  async fetchComments(): Promise<Comment[]> { return []; },
  async postCommentReply(): Promise<ReplyResult> { throw new Error("Bluesky reply: implement via createRecord with reply embed"); },
  async likeTarget() { /* out of scope for v1 */ },
  verifyWebhookSignature: blueskyVerifyWebhookSignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = blueskyParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};
