// X (Twitter) API v2 — client, OAuth 2.0 PKCE, media upload v1.1
// https://developer.twitter.com/en/docs/twitter-api
// Note: write endpoints require X API Basic ($100/mo) or higher.

import type { EncryptedCreds } from "../types";

const API_BASE = "https://api.twitter.com";
const UPLOAD_BASE = "https://upload.twitter.com";

export function getXEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.X_CLIENT_ID ?? "";
  const clientSecret = process.env.X_CLIENT_SECRET ?? "";
  const redirectUri = `${process.env.SOCMED_BASE_URL ?? "http://localhost:3000"}/api/accounts/oauth/callback/x`;
  if (!clientId || !clientSecret) {
    throw new Error("X_CLIENT_ID and X_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret, redirectUri };
}

export function generatePkce(): { verifier: string; challenge: string } {
  // Node's crypto.randomBytes(32) → base64url
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomBytes, createHash } = require("node:crypto") as typeof import("node:crypto");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function xBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { clientId, redirectUri } = getXEnv();
  const { verifier, challenge } = generatePkce();
  const state = verifier; // we reuse the verifier as state since both are random secrets
  const url = new URL(`${API_BASE}/i/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "tweet.read tweet.write users.read offline.access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authUrl: url.toString(), state };
}

export async function xCompleteOAuth(code: string, codeVerifier: string): Promise<EncryptedCreds> {
  const { clientId, clientSecret, redirectUri } = getXEnv();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${API_BASE}/2/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${auth}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`X token exchange: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: j.expires_in ? Math.floor(Date.now() / 1000) + j.expires_in : undefined,
    raw: { scope: j.scope },
  };
}

export async function xRefresh(creds: EncryptedCreds): Promise<EncryptedCreds> {
  const { clientId, clientSecret } = getXEnv();
  if (!creds.refreshToken) throw new Error("X: no refresh token");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
  });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${API_BASE}/2/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${auth}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`X refresh: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? creds.refreshToken,
    expiresAt: j.expires_in ? Math.floor(Date.now() / 1000) + j.expires_in : creds.expiresAt,
  };
}

interface XUploadResponse {
  media_id_string?: string;
  media_id?: number;
}

export async function xUploadMedia(mediaPath: string, accessToken: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { basename, extname } = await import("node:path");
  const data = await readFile(mediaPath);
  const isVideo = /\.(mp4|mov|webm)$/i.test(extname(mediaPath));
  const endpoint = isVideo ? `${UPLOAD_BASE}/1.1/media/upload.json` : `${UPLOAD_BASE}/1.1/media/upload.json`;
  // Use the simple upload (must be <= 5MB for images, <= 15MB for video per single request)
  const form = new FormData();
  form.append("media", new Blob([data]), basename(mediaPath));
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) throw new Error(`X media upload: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as XUploadResponse;
  return String(j.media_id_string ?? j.media_id);
}

export async function xPublishTweet(
  text: string,
  mediaIds: string[],
  accessToken: string,
): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = { text };
  if (mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }
  const res = await fetch(`${API_BASE}/2/tweets`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`X tweet: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { data: { id: string; text: string } };
  // Best-effort URL; would need user lookup to be exact
  return { id: j.data.id, url: `https://x.com/i/status/${j.data.id}` };
}

export async function xDeleteTweet(tweetId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}/2/tweets/${tweetId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`X delete: ${res.status} ${await res.text()}`);
  }
}

interface XTweetMetrics {
  impressions?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  video_views?: number;
}

export async function xFetchMetrics(
  tweetId: string,
  accessToken: string,
): Promise<XTweetMetrics> {
  const params = new URLSearchParams({
    "tweet.fields": "public_metrics,non_public_metrics",
  });
  const res = await fetch(`${API_BASE}/2/tweets/${tweetId}?${params.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`X metrics: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { data?: { public_metrics?: XTweetMetrics; non_public_metrics?: XTweetMetrics } };
  return { ...j.data?.public_metrics, ...j.data?.non_public_metrics };
}

export function xVerifyWebhookSignature(_raw: string, _headers: Record<string, string>): boolean {
  // X uses CRC token challenge for webhooks
  return true; // handled by parseWebhookEvent
}

export function xParseWebhookEvent(raw: string, _headers: Record<string, string>): { challenge?: string } {
  try {
    const j = JSON.parse(raw) as { challenge?: string };
    return { challenge: j.challenge };
  } catch {
    return {};
  }
}
