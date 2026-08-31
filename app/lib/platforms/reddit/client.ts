// Reddit OAuth 2.0 + API
// https://www.reddit.com/dev/api/
//
// Setup:
//   1. reddit.com/prefs/apps → "create another app" → "script" type
//   2. Redirect URI: <SOCMED_BASE_URL>/api/accounts/oauth/callback/reddit
//   3. Note: Reddit uses a permanent "refresh token" model; access tokens last 1 hour
//
// Posting: POST /api/submit with sr (subreddit), kind, title (for link), text (for self)

import type { EncryptedCreds } from "../types";

const API = "https://oauth.reddit.com";
const AUTH = "https://www.reddit.com/api/v1";

export function getRedditEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.REDDIT_CLIENT_ID ?? "";
  const clientSecret = process.env.REDDIT_CLIENT_SECRET ?? "";
  const redirectUri = `${process.env.SOCMED_BASE_URL ?? "http://localhost:3000"}/api/accounts/oauth/callback/reddit`;
  if (!clientId || !clientSecret) {
    throw new Error("REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret, redirectUri };
}

export async function redditBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { clientId, redirectUri } = getRedditEnv();
  const { randomBytes } = await import("node:crypto");
  const state = randomBytes(16).toString("base64url");
  const url = new URL(`${AUTH}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("duration", "permanent");
  url.searchParams.set("scope", "submit,read,identity");
  return { authUrl: url.toString(), state };
}

export async function redditCompleteOAuth(code: string): Promise<EncryptedCreds> {
  const { clientId, clientSecret, redirectUri } = getRedditEnv();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${AUTH}/access_token`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "socmed:v1.0 (by /u/socmed)" },
    body,
  });
  if (!res.ok) throw new Error(`Reddit token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
    raw: { scope: j.scope },
  };
}

export async function redditRefresh(creds: EncryptedCreds): Promise<EncryptedCreds> {
  const { clientId, clientSecret } = getRedditEnv();
  if (!creds.refreshToken) throw new Error("Reddit: no refresh token");
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
  });
  const res = await fetch(`${AUTH}/access_token`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "socmed:v1.0" },
    body,
  });
  if (!res.ok) throw new Error(`Reddit refresh: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: creds.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
  };
}

export async function redditMe(accessToken: string): Promise<{ name: string }> {
  const res = await fetch(`${API}/api/v1/me`, {
    headers: { authorization: `Bearer ${accessToken}`, "user-agent": "socmed:v1.0" },
  });
  if (!res.ok) throw new Error(`Reddit /me: ${res.status} ${await res.text()}`);
  return (await res.json()) as { name: string };
}

export async function redditSubmit(
  subreddit: string,
  title: string,
  text: string,
  accessToken: string,
  kind: "self" | "link" = "self",
  url?: string,
): Promise<{ id: string; url: string; name: string }> {
  const body = new URLSearchParams({ sr: subreddit, title, kind, resubmit: "true" });
  if (kind === "self") body.append("text", text);
  if (kind === "link" && url) body.append("url", url);
  const res = await fetch(`${API}/api/submit`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "socmed:v1.0" },
    body,
  });
  if (!res.ok) throw new Error(`Reddit submit: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { json: { data: { id: string; url: string; name: string }; errors: string[] } };
  if (j.json.errors.length > 0) throw new Error(`Reddit errors: ${JSON.stringify(j.json.errors)}`);
  return j.json.data;
}

export async function redditDelete(fullname: string, accessToken: string): Promise<void> {
  const body = new URLSearchParams({ id: fullname });
  const res = await fetch(`${API}/api/del`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "socmed:v1.0" },
    body,
  });
  if (!res.ok) throw new Error(`Reddit delete: ${res.status} ${await res.text()}`);
}

export async function redditFetchPostComments(
  subreddit: string,
  postId: string,
  accessToken: string,
): Promise<Array<{ id: string; author: string; body: string; created_utc: number }>> {
  const url = new URL(`${API}/r/${subreddit}/comments/${postId}`);
  url.searchParams.set("limit", "50");
  url.searchParams.set("sort", "new");
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}`, "user-agent": "socmed:v1.0" },
  });
  if (!res.ok) return [];
  const j = (await res.json()) as [unknown, { data: { children: Array<{ data: { id: string; author: string; body: string; created_utc: number } }> } }];
  return j[1]?.data?.children?.map((c) => c.data) ?? [];
}

export async function redditReply(
  parentFullname: string,
  text: string,
  accessToken: string,
): Promise<{ id: string }> {
  const body = new URLSearchParams({ parent_id: parentFullname, text });
  const res = await fetch(`${API}/api/comment`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "socmed:v1.0" },
    body,
  });
  if (!res.ok) throw new Error(`Reddit reply: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { json: { data: { id: string }; errors: string[] } };
  if (j.json.errors.length > 0) throw new Error(`Reddit reply errors: ${JSON.stringify(j.json.errors)}`);
  return { id: j.json.data.id };
}

export function redditVerifyWebhookSignature(_raw: string, _headers: Record<string, string>): boolean { return true; }
export function redditParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } { return {}; }
