import type { PlatformAdapter, PublishInput, PublishResult, AnalyticsSnapshot, Comment, Mention, ReplyResult } from "../types";
import type { AdapterContext } from "../types";
import { RefreshUnsupportedError } from "../types";
import {
  discordDeleteMessage,
  discordFetchRecentMessages,
  discordGetBotUserId,
  discordListGuildChannels,
  discordParseWebhookEvent,
  discordPostMessage,
  discordReplyToMessage,
  discordVerifySignature,
} from "./client";

interface DiscordRawCreds {
  accessToken: string;
  raw?: {
    guildId?: string;
    channelIds?: string[];
    botUserId?: string;
  };
}

function asCreds(rawCreds: Record<string, unknown> | undefined): DiscordRawCreds {
  if (!rawCreds || typeof rawCreds.accessToken !== "string") {
    throw new Error("Discord: missing bot token in creds");
  }
  const r = (rawCreds.raw as DiscordRawCreds["raw"]) ?? {};
  return { accessToken: rawCreds.accessToken, raw: r };
}

/**
 * Every Discord REST call needs the channel in the path, so a message id alone
 * is not enough to act on a message. Ids are therefore stored as
 * `channelId|messageId` — the shape fetchMentions has always produced.
 *
 * publishPost used to store a bare message id, so rows created before that fix
 * cannot be split. Those are recovered from the account's configured channel
 * when exactly one is set; with several there is no way to tell which one the
 * message went to, and guessing would delete or reply in the wrong place.
 */
function splitMessageRef(
  ref: string,
  creds: DiscordRawCreds,
  what: string,
): { channelId: string; messageId: string } {
  const parts = ref.split("|");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { channelId: parts[0], messageId: parts[1] };
  }
  const channelIds = creds.raw?.channelIds ?? [];
  if (parts.length === 1 && parts[0] && channelIds.length === 1) {
    return { channelId: channelIds[0]!, messageId: parts[0] };
  }
  throw new Error(
    `Discord: cannot resolve the channel for this ${what} ("${ref}"). ` +
      "Posts published before the id format was fixed store only a message id, " +
      "and this account has " +
      (channelIds.length === 0 ? "no configured channel" : `${channelIds.length} configured channels`) +
      " to recover it from.",
  );
}

export const discordAdapter: PlatformAdapter = {
  platform: "discord",
  async beginOAuth() { throw new Error("Discord does not use OAuth — add a bot token on the Accounts page"); },
  async completeOAuth() { throw new Error("Discord does not use OAuth"); },
  async refresh(): Promise<never> {
    throw new RefreshUnsupportedError("Discord bot tokens do not need refresh");
  },
  async publishPost(input: PublishInput, _ctx: AdapterContext): Promise<PublishResult> {
    if (!input.rawCreds) throw new Error("Discord: no creds");
    const c = asCreds(input.rawCreds);
    const channelIds = c.raw?.channelIds ?? [];
    if (channelIds.length === 0) throw new Error("Discord: no channelIds configured for this account (re-add with channel IDs)");
    const ch = input.channelId ?? channelIds[0]!;
    const r = await discordPostMessage(c.accessToken, ch, input.caption, {
      attachmentPaths: input.mediaPaths,
    });
    // Composite on purpose: deletePost, postCommentReply and postComment all
    // need the channel, and it is not recoverable from a message id.
    return { platformPostId: `${ch}|${r.id}`, platformPostUrl: r.url };
  },
  async deletePost(id: string, _token: string, ctx: AdapterContext) {
    const c = asCreds(ctx.account._creds);
    const { channelId, messageId } = splitMessageRef(id, c, "post");
    // The first argument is the bot token. It used to be handed the channel id,
    // so every delete authenticated as `Bot <channelId>` and failed.
    return discordDeleteMessage(c.accessToken, channelId, messageId);
  },
  async fetchPostMetrics(): Promise<AnalyticsSnapshot> {
    return { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, videoViews: 0, watchTimeMs: 0, engagementRate: 0 };
  },
  async fetchMentions(_token: string, _since: number, ctx: AdapterContext): Promise<{ mentions: Mention[]; nextCursor?: string }> {
    const rawCreds = (ctx.account as { _creds?: Record<string, unknown> })._creds;
    const c = asCreds(rawCreds);
    const channelIds = c.raw?.channelIds ?? [];
    const botUserId = c.raw?.botUserId;
    if (!botUserId) return { mentions: [] };
    const all: Mention[] = [];
    for (const ch of channelIds) {
      const msgs = await discordFetchRecentMessages(c.accessToken, ch, Date.now() - 7 * 24 * 60 * 60 * 1000, botUserId);
      for (const m of msgs) {
        if (m.mentionsBot || m.referenceMessageId) {
          all.push({
            platformMentionId: `${m.channelId}|${m.id}`,
            authorHandle: m.authorUsername,
            authorName: m.authorUsername,
            text: m.content,
            mentionedAt: m.timestamp,
            url: `https://discord.com/channels/@me/${m.channelId}/${m.id}`,
          });
        }
      }
    }
    return { mentions: all };
  },
  async fetchComments(): Promise<Comment[]> { return []; },
  async postCommentReply(platformCommentId: string, text: string, _token: string, ctx: AdapterContext): Promise<ReplyResult> {
    const c = asCreds(ctx.account._creds);
    const { channelId, messageId } = splitMessageRef(platformCommentId, c, "comment");
    const r = await discordReplyToMessage(c.accessToken, channelId, messageId, text);
    // Composite so a reply can itself be replied to.
    return { platformCommentId: `${channelId}|${r.id}` };
  },
  async postComment(platformPostId: string, text: string, _token: string, ctx: AdapterContext): Promise<ReplyResult> {
    // On Discord a first comment is a message in the same channel referencing
    // the post, which is the same call as replying to one.
    const c = asCreds(ctx.account._creds);
    const { channelId, messageId } = splitMessageRef(platformPostId, c, "post");
    const r = await discordReplyToMessage(c.accessToken, channelId, messageId, text);
    return { platformCommentId: `${channelId}|${r.id}` };
  },
  async likeTarget() { /* Discord has no public like for bots */ },
  verifyWebhookSignature: discordVerifySignature,
  parseWebhookEvent: (raw, headers) => {
    const { challenge } = discordParseWebhookEvent(raw, headers);
    if (challenge) return [];
    try { return [{ kind: "other", raw: JSON.parse(raw) }]; } catch { return []; }
  },
};

export { discordListGuildChannels, discordGetBotUserId };
