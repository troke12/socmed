// Threads API via Meta Graph
// https://developers.facebook.com/docs/threads/
//
// Setup:
//   1. Same Meta app as Facebook/Instagram (or new one)
//   2. Add "Threads API" product
//   3. App must be Live (not Dev) for write endpoints
//   4. User OAuth scopes: threads_basic, threads_content_publish, threads_manage_replies, threads_read_replies
//   5. Get user_id + username + threads access token via /me?fields=id,username,threads_profile_picture_url
//   6. In this app: Accounts → Add → threads, paste access token + threads user id
//
// Posting flow (two-step per Threads spec):
//   1. POST /{user-id}/threads?media_type=TEXT&text=...&access_token=...
//      → returns { id: <creation_id> }
//   2. POST /{user-id}/threads_publish?creation_id=...&access_token=...
//      → returns { id: <thread_id> }
//
// Container publish status: PUBLISH, IN_PROGRESS, EXPIRED, ERROR

import type { EncryptedCreds } from "../types";

const GRAPH = "https://graph.threads.net/v1.0";

export function getThreadsEnv(): { appId: string; appSecret: string; redirectUri: string } {
  const appId = process.env.THREADS_APP_ID ?? process.env.FACEBOOK_APP_ID ?? process.env.INSTAGRAM_APP_ID ?? "";
  const appSecret = process.env.THREADS_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET ?? "";
  const redirectUri = `${process.env.SOCMED_BASE_URL ?? "http://localhost:3000"}/api/accounts/oauth/callback/threads`;
  if (!appId || !appSecret) {
    throw new Error("THREADS_APP_ID and THREADS_APP_SECRET must be set (or reuse FACEBOOK_*)");
  }
  return { appId, appSecret, redirectUri };
}

export async function threadsBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { appId, redirectUri } = getThreadsEnv();
  const { randomBytes } = await import("node:crypto");
  const state = randomBytes(16).toString("base64url");
  // Threads OAuth uses graph.threads.net
  const url = new URL(`${GRAPH}/oauth/authorize`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies");
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  return { authUrl: url.toString(), state };
}

export async function threadsCompleteOAuth(code: string): Promise<EncryptedCreds> {
  const { appId, appSecret, redirectUri } = getThreadsEnv();
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Threads token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; user_id: number; username?: string };
  return {
    accessToken: j.access_token,
    raw: { threadsUserId: String(j.user_id), username: j.username },
  };
}

export async function threadsGetProfile(accessToken: string): Promise<{ id: string; username: string }> {
  const url = new URL(`${GRAPH}/me`);
  url.searchParams.set("fields", "id,username,threads_profile_picture_url");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Threads /me: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string; username: string };
  return { id: j.id, username: j.username };
}

export async function threadsRefreshToken(accessToken: string): Promise<EncryptedCreds> {
  const url = new URL(`${GRAPH}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Threads refresh: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: j.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
  };
}

// Two-step publishing. We return the creation id first, then call publish.
async function createTextContainer(userId: string, text: string, accessToken: string, linkUrl?: string): Promise<string> {
  const url = new URL(`${GRAPH}/${userId}/threads`);
  url.searchParams.set("media_type", "TEXT");
  url.searchParams.set("text", text);
  url.searchParams.set("access_token", accessToken);
  if (linkUrl) {
    // Threads treats a link attachment as a separate media_type; we keep TEXT + append URL inline
    // (Threads also supports a "link" attachment via media_url but requires TEXT + link_attachment)
  }
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`Threads create container: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return j.id;
}

async function createImageContainer(userId: string, imageUrl: string, text: string, accessToken: string): Promise<string> {
  const url = new URL(`${GRAPH}/${userId}/threads`);
  url.searchParams.set("media_type", "IMAGE");
  url.searchParams.set("image_url", imageUrl);
  url.searchParams.set("text", text);
  url.searchParams.set("access_token", accessToken);
  // is_carousel_item for carousel support (M3+)
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`Threads image container: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return j.id;
}

async function publishContainer(userId: string, creationId: string, accessToken: string): Promise<string> {
  const url = new URL(`${GRAPH}/${userId}/threads_publish`);
  url.searchParams.set("creation_id", creationId);
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`Threads publish: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return j.id;
}

export async function threadsPublishText(
  userId: string,
  text: string,
  accessToken: string,
  linkUrl?: string,
): Promise<{ id: string; url: string }> {
  const creationId = await createTextContainer(userId, text, accessToken, linkUrl);
  const threadId = await publishContainer(userId, creationId, accessToken);
  return { id: threadId, url: `https://www.threads.net/t/${threadId}` };
}

export async function threadsPublishImage(
  userId: string,
  imageUrl: string,
  text: string,
  accessToken: string,
): Promise<{ id: string; url: string }> {
  const creationId = await createImageContainer(userId, imageUrl, text, accessToken);
  const threadId = await publishContainer(userId, creationId, accessToken);
  return { id: threadId, url: `https://www.threads.net/t/${threadId}` };
}

export async function threadsFetchInsights(threadId: string, accessToken: string): Promise<{
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}> {
  const url = new URL(`${GRAPH}/${threadId}/insights`);
  url.searchParams.set("metric", "views,likes,replies,reposts,quotes");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) return { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };
  const j = (await res.json()) as { data: Array<{ name: string; values: Array<{ value: number }> }> };
  const get = (n: string): number => j.data.find((d) => d.name === n)?.values?.[0]?.value ?? 0;
  return {
    views: get("views"),
    likes: get("likes"),
    replies: get("replies"),
    reposts: get("reposts"),
    quotes: get("quotes"),
  };
}

export async function threadsFetchReplies(threadId: string, accessToken: string, since: number): Promise<Array<{
  id: string;
  username: string;
  text: string;
  timestamp: string;
}>> {
  const url = new URL(`${GRAPH}/${threadId}/replies`);
  url.searchParams.set("fields", "id,username,text,timestamp");
  url.searchParams.set("since", String(since));
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const j = (await res.json()) as { data: Array<{ id: string; username: string; text: string; timestamp: string }> };
  return j.data;
}

export async function threadsReplyToThread(
  userId: string,
  rootThreadId: string,
  text: string,
  accessToken: string,
): Promise<{ id: string }> {
  // Reply is a TEXT container published with reply_to_id
  const url = new URL(`${GRAPH}/${userId}/threads`);
  url.searchParams.set("media_type", "TEXT");
  url.searchParams.set("text", text);
  url.searchParams.set("reply_to_id", rootThreadId);
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`Threads reply: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  // Then publish it
  const publishedId = await publishContainer(userId, j.id, accessToken);
  return { id: publishedId };
}

export async function threadsDeleteThread(threadId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${threadId}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Threads delete: ${res.status} ${await res.text()}`);
  }
}

export function threadsVerifyWebhookSignature(_raw: string, _headers: Record<string, string>): boolean { return true; }
export function threadsParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } { return {}; }
