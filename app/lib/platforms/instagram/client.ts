// Instagram Graph API (Business/Creator account required)
// https://developers.facebook.com/docs/instagram-api/

import type { EncryptedCreds } from "../types";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export function getInstagramEnv(): { appId: string; appSecret: string; redirectUri: string } {
  const appId = process.env.INSTAGRAM_APP_ID ?? "";
  const appSecret = process.env.INSTAGRAM_APP_SECRET ?? "";
  const redirectUri = `${process.env.SOCMED_BASE_URL ?? "http://localhost:3000"}/api/accounts/oauth/callback/instagram`;
  if (!appId || !appSecret) {
    throw new Error("INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET must be set");
  }
  return { appId, appSecret, redirectUri };
}

export async function instagramBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { appId, redirectUri } = getInstagramEnv();
  const { randomBytes } = await import("node:crypto");
  const state = randomBytes(16).toString("base64url");
  const url = new URL(`${GRAPH_BASE}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish");
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  return { authUrl: url.toString(), state };
}

export async function instagramCompleteOAuth(code: string): Promise<EncryptedCreds> {
  const { appId, appSecret, redirectUri } = getInstagramEnv();
  // Exchange code for short-lived token
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Instagram token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string };
  // Exchange for long-lived token
  const llUrl = new URL(`${GRAPH_BASE}/access_token`);
  llUrl.searchParams.set("grant_type", "ig_exchange_token");
  llUrl.searchParams.set("client_secret", appSecret);
  llUrl.searchParams.set("access_token", j.access_token);
  const llRes = await fetch(llUrl.toString());
  if (!llRes.ok) throw new Error(`Instagram long-lived: ${llRes.status} ${await llRes.text()}`);
  const ll = (await llRes.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: ll.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + ll.expires_in,
  };
}

export async function instagramRefresh(creds: EncryptedCreds): Promise<EncryptedCreds> {
  // Long-lived tokens are refreshed when they're > 24h old and < 60 days
  const url = new URL(`${GRAPH_BASE}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", creds.accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Instagram refresh: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: j.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
  };
}

interface IgUser {
  id: string;
  username: string;
}

async function igGetMe(accessToken: string): Promise<IgUser> {
  const url = new URL(`${GRAPH_BASE}/me`);
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`IG me: ${res.status} ${await res.text()}`);
  return (await res.json()) as IgUser;
}

// Find the linked Instagram Business account from a Facebook Page
async function igGetIgUserId(pageId: string, accessToken: string): Promise<string> {
  const url = new URL(`${GRAPH_BASE}/${pageId}`);
  url.searchParams.set("fields", "instagram_business_account{id,username}");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`IG page: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { instagram_business_account?: { id: string } };
  if (!j.instagram_business_account) {
    throw new Error("No Instagram Business account linked to this Page. Connect a Page in Meta Business Suite first.");
  }
  return j.instagram_business_account.id;
}

export async function instagramPublishMedia(
  caption: string,
  mediaPath: string,
  accessToken: string,
): Promise<{ id: string; url: string }> {
  const { readFile } = await import("node:fs/promises");
  const { extname } = await import("node:path");
  const ext = extname(mediaPath).toLowerCase();
  // We need a public URL for the IG container; require user to host media on their own.
  // For now, throw a clear error.
  throw new Error(
    `Instagram publishing requires a public media URL. Host ${ext} files on your CDN and pass them in the post, or use the upload UI to add an external_url.`,
  );
  // The below is the container flow (kept for reference):
  // 1. POST /me/media?image_url=...&caption=...&access_token=...
  // 2. POST /me/media_publish?creation_id=...&access_token=...
  void readFile;
}

export function instagramVerifyWebhookSignature(_raw: string, _headers: Record<string, string>): boolean {
  return true;
}

export function instagramParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } {
  return {};
}
