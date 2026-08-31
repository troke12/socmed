import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment, Mention, ReplyResult } from "../types";
import type { AdapterContext } from "../types";
import {
  blueskyCreatePost,
  blueskyCreateSession,
  blueskyDeletePost,
  blueskyIsVideoPath,
  blueskyListNotifications,
  blueskyParseWebhookEvent,
  blueskyRefreshSession,
  blueskyUploadBlob,
  blueskyUploadVideo,
  blueskyVerifyWebhookSignature,
  getBlueskyPDS,
  type BlueskyEmbed,
} from "./client";
import { blueskyEnsureSession } from "./session";

// Every authenticated call goes through here: the stored app password is not a
// bearer token, so we need a live accessJwt against the account's real PDS.
function session(ctx: AdapterContext) {
  return blueskyEnsureSession(ctx.account);
}

export const blueskyAdapter: PlatformAdapter = {
  platform: "bluesky",
  async beginOAuth() { throw new Error("Bluesky uses app passwords, not OAuth — add on Accounts page"); },
  async completeOAuth() { throw new Error("Bluesky uses app passwords, not OAuth"); },
  // Standalone refresh (no AdapterContext, so nothing to persist to here — the
  // caller stores the returned creds). Falls back to createSession with the
  // stored app password when there is no usable refreshJwt yet, which is the
  // case immediately after the account is added.
  async refresh(creds: DecryptedCreds) {
    const raw = (creds.raw as { did?: string; handle?: string; appPassword?: string } | undefined) ?? {};
    const pds = getBlueskyPDS(creds as unknown as Record<string, unknown>);
    if (creds.refreshToken && raw.did) {
      try {
        const r = await blueskyRefreshSession(creds.refreshToken, pds);
        return { ...creds, accessToken: r.accessJwt, refreshToken: r.refreshJwt } as EncryptedCreds;
      } catch {
        // fall through to a fresh createSession
      }
    }
    const appPassword = raw.appPassword ?? (raw.did ? undefined : creds.accessToken);
    const identifier = raw.handle ?? raw.did;
    if (!appPassword || !identifier) {
      throw new Error("Bluesky: cannot refresh — no app password/identifier in creds (re-add the account)");
    }
    const s = await blueskyCreateSession(identifier, appPassword, pds);
    return {
      accessToken: s.accessJwt,
      refreshToken: s.refreshJwt,
      raw: { ...raw, did: s.did, handle: s.handle, pdsUrl: pds, appPassword },
    } as EncryptedCreds;
  },
  async publishPost(input: PublishInput, ctx: AdapterContext): Promise<PublishResult> {
    const s = await session(ctx);
    const paths = input.mediaPaths ?? [];
    let embed: BlueskyEmbed | undefined;
    if (paths.length > 0) {
      // Bluesky posts carry either up to 4 images OR exactly 1 video, never
      // both — mirrors the app.bsky.embed.images / app.bsky.embed.video split.
      if (blueskyIsVideoPath(paths[0]!)) {
        const video = await blueskyUploadVideo(s.pdsUrl, s.accessJwt, s.did, paths[0]!);
        embed = { kind: "video", video };
      } else {
        const images = await Promise.all(
          paths.slice(0, 4).map((p) => blueskyUploadBlob(s.pdsUrl, s.accessJwt, p)),
        );
        embed = { kind: "images", images };
      }
    }
    const r = await blueskyCreatePost(s.pdsUrl, s.accessJwt, s.did, input.caption, { embed });
    return { platformPostId: r.uri, platformPostUrl: r.url };
  },
  async deletePost(uri: string, _token: string, ctx: AdapterContext) {
    const s = await session(ctx);
    const rkey = uri.split("/").pop();
    if (!rkey) throw new Error("Bluesky: invalid uri");
    return blueskyDeletePost(s.pdsUrl, s.accessJwt, s.did, rkey);
  },
  async fetchPostMetrics(): Promise<AnalyticsSnapshot> {
    return { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, videoViews: 0, watchTimeMs: 0, engagementRate: 0 };
  },
  async fetchMentions(_token: string, since: number, ctx: AdapterContext): Promise<{ mentions: Mention[]; nextCursor?: string }> {
    const s = await session(ctx);
    const sinceIso = since > 0 ? new Date(since * 1000).toISOString() : undefined;
    const notes = await blueskyListNotifications(s.pdsUrl, s.accessJwt, sinceIso);
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
