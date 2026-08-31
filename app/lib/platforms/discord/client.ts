// Discord — Bot API (not OAuth for the user; we store a bot token + guild id).
// https://discord.com/developers/docs/reference
//
// Setup:
//   1. Create an app at discord.com/developers/applications
//   2. Bot tab → add bot → copy token → DISCORD_BOT_TOKEN env
//   3. OAuth2 → URL Generator → scope=bot, permissions=Send Messages (and Read Messages for mentions)
//   4. Open the URL, invite the bot to your server
//   5. Enable "Message Content Intent" in the Bot tab for read access
//   6. In this app: Accounts → Add → discord, paste bot token + guild ID + channel ID
//
// Posting: POST /channels/{channel.id}/messages with content/embeds/attachments
// Mentions/comments: via gateway or fetch /channels/{id}/messages; webhooks aren't useful for
// bots, so we poll (M5 worker poller reads recent messages, inserts as "mentions" rows).

import type { EncryptedCreds } from "../types";
import { verifyHmacHeader } from "../../security/webhook";

const API = "https://discord.com/api/v10";

export function getDiscordEnv(): { botToken: string | null } {
  return { botToken: process.env.DISCORD_BOT_TOKEN ?? null };
}

export interface DiscordCreds extends EncryptedCreds {
  accessToken: string; // bot token
  raw?: {
    guildId?: string;
    channelIds?: string[];
  };
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

export async function discordListGuildChannels(botToken: string, guildId: string): Promise<DiscordChannel[]> {
  const res = await fetch(`${API}/guilds/${guildId}/channels`, {
    headers: { authorization: `Bot ${botToken}` },
  });
  if (!res.ok) throw new Error(`Discord channels: ${res.status} ${await res.text()}`);
  const arr = (await res.json()) as Array<{ id: string; name: string; type: number }>;
  // 0 = text channel
  return arr.filter((c) => c.type === 0).map((c) => ({ id: c.id, name: c.name, type: c.type }));
}

export async function discordPostMessage(
  botToken: string,
  channelId: string,
  content: string,
  options: { embeds?: unknown[]; attachmentPaths?: string[] } = {},
): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = { content };
  if (options.embeds && options.embeds.length > 0) body.embeds = options.embeds;

  if (options.attachmentPaths && options.attachmentPaths.length > 0) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(body));
    for (let i = 0; i < options.attachmentPaths.length; i++) {
      const p = options.attachmentPaths[i]!;
      const data = await import("node:fs/promises").then((m) => m.readFile(p));
      const { basename } = await import("node:path");
      form.append(`files[${i}]`, new Blob([data]), basename(p));
    }
    const res = await fetch(`${API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${botToken}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Discord post: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { id: string; channel_id: string; guild_id?: string };
    return { id: j.id, url: `https://discord.com/channels/${j.guild_id ?? "@me"}/${j.channel_id}/${j.id}` };
  }

  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord post: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string; channel_id: string; guild_id?: string };
  return { id: j.id, url: `https://discord.com/channels/${j.guild_id ?? "@me"}/${j.channel_id}/${j.id}` };
}

export async function discordEditMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  content: string,
): Promise<void> {
  const res = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Discord edit: ${res.status} ${await res.text()}`);
}

export async function discordDeleteMessage(botToken: string, channelId: string, messageId: string): Promise<void> {
  const res = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    headers: { authorization: `Bot ${botToken}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Discord delete: ${res.status} ${await res.text()}`);
}

export async function discordReplyToMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  content: string,
): Promise<{ id: string; url: string }> {
  const body = { content, message_reference: { message_id: messageId, fail_if_not_exists: false } };
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord reply: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string; channel_id: string; guild_id?: string };
  return { id: j.id, url: `https://discord.com/channels/${j.guild_id ?? "@me"}/${j.channel_id}/${j.id}` };
}

export interface DiscordRecentMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorUsername: string;
  content: string;
  timestamp: number;
  mentionsBot: boolean;
  referenceMessageId: string | null;
}

export async function discordFetchRecentMessages(
  botToken: string,
  channelId: string,
  sinceMs: number,
  botUserId: string,
  limit = 50,
): Promise<DiscordRecentMessage[]> {
  const res = await fetch(`${API}/channels/${channelId}/messages?limit=${limit}`, {
    headers: { authorization: `Bot ${botToken}` },
  });
  if (!res.ok) throw new Error(`Discord list: ${res.status} ${await res.text()}`);
  const arr = (await res.json()) as Array<{
    id: string;
    author: { id: string; username: string; bot?: boolean };
    content: string;
    timestamp: string;
    mentions: Array<{ id: string }>;
    message_reference?: { message_id: string };
  }>;
  const out: DiscordRecentMessage[] = [];
  for (const m of arr) {
    const ts = Date.parse(m.timestamp);
    if (ts <= sinceMs) continue;
    if (m.author.bot) continue;
    out.push({
      id: m.id,
      channelId,
      authorId: m.author.id,
      authorUsername: m.author.username,
      content: m.content,
      timestamp: Math.floor(ts / 1000),
      mentionsBot: m.mentions.some((u) => u.id === botUserId),
      referenceMessageId: m.message_reference?.message_id ?? null,
    });
  }
  return out;
}

export async function discordGetBotUserId(botToken: string): Promise<string> {
  const res = await fetch(`${API}/users/@me`, {
    headers: { authorization: `Bot ${botToken}` },
  });
  if (!res.ok) throw new Error(`Discord @me: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string; username: string };
  return j.id;
}

// Webhooks: Discord signs interaction bodies with Ed25519, but socmed does
// not use interaction endpoints — inbound Discord is handled by the poller.
// For any HMAC-signed webhook we still verify when a secret is configured.
export function discordVerifySignature(raw: string, headers: Record<string, string>): boolean {
  const secret = process.env.DISCORD_WEBHOOK_SECRET ?? "";
  return secret.length > 0 && verifyHmacHeader(secret, raw, headers["x-discord-signature"] ?? headers["signature"]);
}
export function discordParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } {
  return {};
}
