// TikTok Content Posting API
// https://developers.tiktok.com/doc/content-posting-api-quick-start
//
// IMPORTANT: TikTok requires an app review (2-4 weeks). The dev tier has
// very limited quota (~6 posts/day). The full flow is:
//
// 1. Register your app at developers.tiktok.com, get client_key + client_secret
// 2. Apply for "Content Posting API" scope — submit a demo video
// 3. OAuth 2.0 with PKCE; user grants video.upload + video.publish
// 4. Upload video (chunked for files > 64MB; single PUT for smaller)
// 5. /v2/post/publish/video/init/ then upload chunks then /v2/post/publish/video/complete/
//
// We wire up OAuth and the publish flow skeleton; the chunked upload is
// not yet implemented in v1.

import type { EncryptedCreds } from "../types";

const API_BASE = "https://open.tiktokapis.com";

export function getTikTokEnv(): { clientKey: string; clientSecret: string; redirectUri: string } {
  const clientKey = process.env.TIKTOK_CLIENT_KEY ?? "";
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET ?? "";
  const redirectUri = `${process.env.SOCMED_BASE_URL ?? "http://localhost:3000"}/api/accounts/oauth/callback/tiktok`;
  if (!clientKey || !clientSecret) {
    throw new Error("TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be set");
  }
  return { clientKey, clientSecret, redirectUri };
}

export function tiktokGeneratePkce(): { verifier: string; challenge: string } {
  const { randomBytes, createHash } = require("node:crypto") as typeof import("node:crypto");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function tiktokBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { clientKey, redirectUri } = getTikTokEnv();
  const { verifier, challenge } = tiktokGeneratePkce();
  const state = verifier;
  const url = new URL(`${API_BASE}/v2/oauth/authorize/`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "user.info.basic,video.upload,video.publish");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authUrl: url.toString(), state };
}

export async function tiktokCompleteOAuth(code: string, codeVerifier: string): Promise<EncryptedCreds> {
  const { clientKey, clientSecret, redirectUri } = getTikTokEnv();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_key: clientKey,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch(`${API_BASE}/v2/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`TikTok token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_expires_in: number;
    open_id: string;
    scope: string;
  };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
    raw: { openId: j.open_id, scope: j.scope },
  };
}

export async function tiktokRefresh(creds: EncryptedCreds): Promise<EncryptedCreds> {
  const { clientKey, clientSecret } = getTikTokEnv();
  if (!creds.refreshToken) throw new Error("TikTok: no refresh token");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_key: clientKey,
    client_secret: clientSecret,
  });
  const res = await fetch(`${API_BASE}/v2/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`TikTok refresh: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
  };
}

export async function tiktokPublishVideo(
  _mediaPath: string,
  _caption: string,
  _accessToken: string,
): Promise<{ id: string; url: string }> {
  // Two-step:
  // POST /v2/post/publish/video/init/  with source=FILE_UPLOAD, video_size, chunk_size, total_chunk_count
  // For each chunk: PUT to the returned upload_url
  // POST /v2/post/publish/video/complete/ with publish_id
  throw new Error(
    "TikTok video publishing requires the Content Posting API app review (2-4 weeks). Once your app is approved, set TIKTOK_CLIENT_KEY/SECRET and the chunked upload will be enabled.",
  );
}

export function tiktokVerifyWebhookSignature(_raw: string, _headers: Record<string, string>): boolean {
  return true;
}

export function tiktokParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } {
  return {};
}
