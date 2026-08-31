import type { PlatformAdapter, EncryptedCreds, DecryptedCreds, PublishInput, PublishResult, AnalyticsSnapshot, Comment, Mention, ReplyResult } from "../types";
import type { AdapterContext } from "../types";
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

export const discordAdapter: PlatformAdapter = {
  platform: "discord",
  async beginOAuth() { throw new Error("Discord does not use OAuth — add a bot token on the Accounts page"); },
  async completeOAuth() { throw new Error("Discord does not use OAuth"); },
  async refresh() {
    throw new Error("Discord bot tokens do not need refresh");
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
    return { platformPostId: r.id, platformPostUrl: r.url };
  },
  async deletePost(id: string, _token: string, _ctx: AdapterContext) {
    const [channelId, messageId] = id.split("|");
    if (!channelId || !messageId) throw new Error("Discord: malformed platform post id (expected channelId|messageId)");
    return discordDeleteMessage(id.split("|")[0]!, channelId, messageId);
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
  async postCommentReply(platformCommentId: string, text: string, _token: string, _ctx: AdapterContext): Promise<ReplyResult> {
    const [channelId, messageId] = platformCommentId.split("|");
    if (!channelId || !messageId) throw new Error("Discord: malformed comment id (expected channelId|messageId)");
    const rawCreds = _ctx.account._creds;
    const c = asCreds(rawCreds);
    const r = await discordReplyToMessage(c.accessToken, channelId, messageId, text);
    return { platformCommentId: `${r.id}` };
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
