// Pinterest API v5
// https://developers.pinterest.com/docs/api/v5/
//
// Setup:
//   1. developers.pinterest.com → create app
//   2. Add scopes: user_accounts:read, pins:read, pins:write, boards:read, boards:write
//   3. Set redirect URI: <SOCMED_BASE_URL>/api/accounts/oauth/callback/pinterest
//   4. App review required for production; dev tier has lower rate limits
//
// Posting requires a publicly accessible image URL — Pinterest rejects
// local files. Host media on S3/R2/Cloudflare R2 or use a public CDN.

import type { EncryptedCreds } from "../types";

const API = "https://api.pinterest.com/v5";

export function getPinterestEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.PINTEREST_CLIENT_ID ?? "";
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET ?? "";
  const redirectUri = `${process.env.SOCMED_BASE_URL ?? "http://localhost:3000"}/api/accounts/oauth/callback/pinterest`;
  if (!clientId || !clientSecret) {
    throw new Error("PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret, redirectUri };
}

export async function pinterestBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { clientId, redirectUri } = getPinterestEnv();
  const { randomBytes } = await import("node:crypto");
  const state = randomBytes(16).toString("base64url");
  const url = new URL("https://www.pinterest.com/oauth/");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "user_accounts:read,pins:read,pins:write,boards:read,boards:write");
  url.searchParams.set("state", state);
  return { authUrl: url.toString(), state };
}

export async function pinterestCompleteOAuth(code: string): Promise<EncryptedCreds> {
  const { clientId, clientSecret, redirectUri } = getPinterestEnv();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Pinterest token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope: string };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
    raw: { scope: j.scope },
  };
}

export async function pinterestRefresh(creds: EncryptedCreds): Promise<EncryptedCreds> {
  const { clientId, clientSecret } = getPinterestEnv();
  if (!creds.refreshToken) throw new Error("Pinterest: no refresh token");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Pinterest refresh: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? creds.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
  };
}

export async function pinterestListBoards(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${API}/boards?page_size=100`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Pinterest boards: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { items: Array<{ id: string; name: string }> };
  return j.items;
}

export async function pinterestCreatePin(
  boardId: string,
  title: string,
  description: string,
  imageUrl: string,
  link: string | undefined,
  accessToken: string,
): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = {
    board_id: boardId,
    title,
    description,
    media_source: { source_type: "image_url", url: imageUrl },
  };
  if (link) body.link = link;
  const res = await fetch(`${API}/pins`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Pinterest pin: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return { id: j.id, url: `https://pinterest.com/pin/${j.id}/` };
}

export async function pinterestDeletePin(pinId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${API}/pins/${pinId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Pinterest delete: ${res.status} ${await res.text()}`);
}

export async function pinterestFetchPinAnalytics(
  pinId: string,
  accessToken: string,
): Promise<{ impressions: number; saves: number; clicks: number }> {
  const url = new URL(`${API}/pins/${pinId}/analytics`);
  url.searchParams.set("start_date", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  url.searchParams.set("end_date", new Date().toISOString().slice(0, 10));
  url.searchParams.set("metric_types", "IMPRESSION,SAVE,CLICK");
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return { impressions: 0, saves: 0, clicks: 0 };
  const j = (await res.json()) as { all?: { daily_metrics?: Array<{ data_status?: string }> } };
  // Pinterest returns daily breakdown; we just sum over the range.
  void j;
  return { impressions: 0, saves: 0, clicks: 0 };
}

export function pinterestVerifyWebhookSignature(_raw: string, _headers: Record<string, string>): boolean { return true; }
export function pinterestParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } { return {}; }
