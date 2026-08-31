// YouTube Data API v3
// https://developers.google.com/youtube/v3
//
// Setup:
//   1. console.cloud.google.com → New project → Enable "YouTube Data API v3"
//   2. OAuth consent screen → External → add scopes: youtube.upload, youtube.readonly, youtube.force-ssl
//   3. Credentials → Create OAuth client (Web application)
//   4. Authorized redirect URI: <SOCMED_BASE_URL>/api/accounts/oauth/callback/youtube
//   5. Set YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET in .env
//   6. User must have a YouTube channel (auto-created with first upload)
//
// Upload (resumable): two-step — create video resource, then PUT bytes.
// Quota: 10,000 units/day default; upload costs 1,600 units.

import type { EncryptedCreds } from "../types";

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";

export function getYouTubeEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.YOUTUBE_CLIENT_ID ?? "";
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET ?? "";
  const redirectUri = `${process.env.SOCMED_BASE_URL ?? "http://localhost:3000"}/api/accounts/oauth/callback/youtube`;
  if (!clientId || !clientSecret) {
    throw new Error("YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret, redirectUri };
}

export function youtubeGeneratePkce(): { verifier: string; challenge: string } {
  const { randomBytes, createHash } = require("node:crypto") as typeof import("node:crypto");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function youtubeBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { clientId, redirectUri } = getYouTubeEnv();
  const { verifier, challenge } = youtubeGeneratePkce();
  const state = verifier;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return { authUrl: url.toString(), state };
}

export async function youtubeCompleteOAuth(code: string, codeVerifier: string): Promise<EncryptedCreds> {
  const { clientId, clientSecret, redirectUri } = getYouTubeEnv();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`YouTube token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
    raw: { scope: j.scope },
  };
}

export async function youtubeRefresh(creds: EncryptedCreds): Promise<EncryptedCreds> {
  const { clientId, clientSecret } = getYouTubeEnv();
  if (!creds.refreshToken) throw new Error("YouTube: no refresh token");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`YouTube refresh: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: creds.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
  };
}

interface YouTubeChannel {
  id: string;
  snippet: { title: string; customUrl?: string };
}

export async function youtubeGetMyChannel(accessToken: string): Promise<YouTubeChannel> {
  const url = new URL(`${API}/channels`);
  url.searchParams.set("part", "id,snippet");
  url.searchParams.set("mine", "true");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`YouTube channels: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { items?: YouTubeChannel[] };
  if (!j.items || j.items.length === 0) throw new Error("YouTube: no channel found for this account");
  return j.items[0]!;
}

// Resumable upload: step 1 — POST metadata with X-Upload-Content-Length to get upload URL
// step 2 — PUT the bytes to the upload URL
export async function youtubeUploadVideo(
  videoPath: string,
  title: string,
  description: string,
  accessToken: string,
  tags: string[] = [],
  privacyStatus: "public" | "unlisted" | "private" = "unlisted",
): Promise<{ id: string; url: string }> {
  const { readFile, stat } = await import("node:fs/promises");
  const { extname } = await import("node:path");
  const ext = extname(videoPath).toLowerCase().replace(".", "");
  const data = await readFile(videoPath);
  const stats = await stat(videoPath);
  const mime = ext === "mp4" ? "video/mp4" : ext === "mov" ? "video/quicktime" : "application/octet-stream";

  const body = JSON.stringify({
    snippet: { title, description, tags },
    status: { privacyStatus },
  });

  // Step 1: init
  const initRes = await fetch(
    `${UPLOAD}/videos?uploadType=resumable&part=snippet,status`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(stats.size),
        "x-upload-content-type": mime,
      },
      body,
    },
  );
  if (!initRes.ok) throw new Error(`YouTube init upload: ${initRes.status} ${await initRes.text()}`);
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube: no upload URL returned");

  // Step 2: PUT bytes
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": mime },
    body: data,
  });
  if (!putRes.ok) throw new Error(`YouTube upload: ${putRes.status} ${await putRes.text()}`);
  const j = (await putRes.json()) as { id: string };
  return { id: j.id, url: `https://www.youtube.com/watch?v=${j.id}` };
}

export async function youtubeFetchVideoStats(
  videoId: string,
  accessToken: string,
): Promise<{ views: number; likes: number; comments: number }> {
  const url = new URL(`${API}/videos`);
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", videoId);
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) return { views: 0, likes: 0, comments: 0 };
  const j = (await res.json()) as { items?: Array<{ statistics: { viewCount?: string; likeCount?: string; commentCount?: string } }> };
  const s = j.items?.[0]?.statistics ?? {};
  return {
    views: Number(s.viewCount ?? 0),
    likes: Number(s.likeCount ?? 0),
    comments: Number(s.commentCount ?? 0),
  };
}

export async function youtubeFetchComments(
  videoId: string,
  accessToken: string,
): Promise<Array<{ id: string; authorDisplayName: string; textDisplay: string; publishedAt: string }>> {
  const url = new URL(`${API}/commentThreads`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("videoId", videoId);
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("order", "time");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const j = (await res.json()) as {
    items: Array<{
      id: string;
      snippet: { topLevelComment: { snippet: { authorDisplayName: string; textDisplay: string; publishedAt: string } } };
    }>;
  };
  return j.items.map((it) => ({
    id: it.id,
    authorDisplayName: it.snippet.topLevelComment.snippet.authorDisplayName,
    textDisplay: it.snippet.topLevelComment.snippet.textDisplay,
    publishedAt: it.snippet.topLevelComment.snippet.publishedAt,
  }));
}

export async function youtubeReplyToComment(
  parentId: string,
  text: string,
  accessToken: string,
): Promise<{ id: string }> {
  const url = new URL(`${API}/comments`);
  url.searchParams.set("part", "snippet");
  url.searchParams.append("access_token", accessToken);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
  });
  if (!res.ok) throw new Error(`YouTube reply: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return { id: j.id };
}

export async function youtubeDeleteVideo(videoId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${API}/videos?id=${videoId}&access_token=${encodeURIComponent(accessToken)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) throw new Error(`YouTube delete: ${res.status} ${await res.text()}`);
}

export function youtubeVerifyWebhookSignature(_raw: string, _headers: Record<string, string>): boolean { return true; }
export function youtubeParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } { return {}; }
