// X (Twitter) API v2 — client, OAuth 2.0 PKCE, v2 chunked media upload
// https://docs.x.com/x-api
// Billing: X API is pay-per-usage on prepaid credits bought in the Developer
// Console — there is no flat monthly tier. Credits are deducted per request at
// per-endpoint rates (post creation and post reads are billed separately), and
// standard (non-Enterprise) accounts are capped at 3M post reads per billing
// cycle; above that you have to talk to sales. Rates change, so check
// https://docs.x.com/x-api/getting-started/pricing rather than trusting a
// number hardcoded in a comment.

import { createHash, randomBytes } from "node:crypto";
import type { EncryptedCreds } from "../types";
import { verifyHmacHeader } from "../../security/webhook";

// api.twitter.com / upload.twitter.com are legacy hosts. Authorize lives on the
// consumer domain (x.com), everything else on api.x.com.
const API_BASE = "https://api.x.com";
const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";

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
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function xBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { clientId, redirectUri } = getXEnv();
  const { verifier, challenge } = generatePkce();
  const state = verifier; // we reuse the verifier as state since both are random secrets
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  // media.write is required by the /2/media/upload/* endpoints; without it the
  // upload fails at initialize even though tweet.write alone lets you post text.
  url.searchParams.set("scope", "tweet.read tweet.write users.read media.write offline.access");
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

// media_type/media_category are enums on /2/media/upload/initialize, so we have
// to map the extension ourselves — sending an unlisted MIME string is rejected.
// media_category also drives server-side processing: tweet_gif and tweet_video
// get async transcoding, tweet_image does not.
const X_MEDIA_TYPES: Record<string, { mediaType: string; mediaCategory: string }> = {
  jpg: { mediaType: "image/jpeg", mediaCategory: "tweet_image" },
  jpeg: { mediaType: "image/jpeg", mediaCategory: "tweet_image" },
  png: { mediaType: "image/png", mediaCategory: "tweet_image" },
  webp: { mediaType: "image/webp", mediaCategory: "tweet_image" },
  bmp: { mediaType: "image/bmp", mediaCategory: "tweet_image" },
  tif: { mediaType: "image/tiff", mediaCategory: "tweet_image" },
  tiff: { mediaType: "image/tiff", mediaCategory: "tweet_image" },
  gif: { mediaType: "image/gif", mediaCategory: "tweet_gif" },
  mp4: { mediaType: "video/mp4", mediaCategory: "tweet_video" },
  mov: { mediaType: "video/quicktime", mediaCategory: "tweet_video" },
  webm: { mediaType: "video/webm", mediaCategory: "tweet_video" },
  ts: { mediaType: "video/mp2t", mediaCategory: "tweet_video" },
};

// APPEND caps segment_index at 999, so chunk size sets the effective ceiling.
// 4 MiB is X's documented per-chunk recommendation and keeps us under the
// 512 MB practical video limit with plenty of headroom. Anything smaller than
// one chunk (i.e. most images) goes up in a single APPEND — no separate
// single-shot code path needed.
const X_CHUNK_BYTES = 4 * 1024 * 1024;
const X_MAX_SEGMENTS = 1000;

// Bound on STATUS polling so a stuck transcode can't hang a publish worker.
const X_PROCESSING_TIMEOUT_MS = 120_000;

interface XProcessingInfo {
  state?: string;
  check_after_secs?: number;
  progress_percent?: number;
  error?: { name?: string; message?: string };
}

interface XMediaUploadData {
  id?: string;
  media_key?: string;
  expires_after_secs?: number;
  processing_info?: XProcessingInfo;
}

interface XMediaUploadResponse {
  data?: XMediaUploadData;
  errors?: unknown[];
}

async function xMediaRequest(
  label: string,
  url: string,
  accessToken: string,
  init: RequestInit,
): Promise<XMediaUploadResponse> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`X media ${label}: ${res.status} ${await res.text()}`);
  // APPEND returns {data:{expires_at}}; a 204/empty body is still a success.
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text) as XMediaUploadResponse;
}

async function xWaitForProcessing(
  mediaId: string,
  info: XProcessingInfo,
  accessToken: string,
): Promise<void> {
  // Track the whole latest info object, not just the state, so the failure we
  // report is the one that actually came back from the final poll.
  let latest = info;
  let waitSecs = info.check_after_secs ?? 1;
  const deadline = Date.now() + X_PROCESSING_TIMEOUT_MS;
  // FINALIZE can already report "failed" before we ever poll, so check the
  // state we were handed before sleeping.
  while (latest.state === "pending" || latest.state === "in_progress") {
    if (Date.now() >= deadline) {
      throw new Error(
        `X media processing: timed out after ${X_PROCESSING_TIMEOUT_MS}ms (state=${latest.state})`,
      );
    }
    await new Promise((r) => setTimeout(r, Math.max(1, waitSecs) * 1000));
    const params = new URLSearchParams({ command: "STATUS", media_id: mediaId });
    const j = await xMediaRequest("status", `${API_BASE}/2/media/upload?${params.toString()}`, accessToken, {
      method: "GET",
    });
    const next = j.data?.processing_info;
    if (!next) return; // no processing_info left => nothing pending
    latest = next;
    waitSecs = next.check_after_secs ?? waitSecs;
  }
  if (latest.state === "failed") {
    throw new Error(
      `X media processing failed: ${latest.error?.name ?? "unknown"} ${latest.error?.message ?? ""}`.trim(),
    );
  }
}

export async function xUploadMedia(mediaPath: string, accessToken: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { basename, extname } = await import("node:path");
  const data = await readFile(mediaPath);
  const ext = extname(mediaPath).replace(".", "").toLowerCase();
  const kind = X_MEDIA_TYPES[ext];
  if (!kind) throw new Error(`X media upload: unsupported file type ".${ext}"`);

  const segments = Math.max(1, Math.ceil(data.length / X_CHUNK_BYTES));
  if (segments > X_MAX_SEGMENTS) {
    throw new Error(`X media upload: file too large (${data.length} bytes exceeds the chunked upload limit)`);
  }

  const init = await xMediaRequest("initialize", `${API_BASE}/2/media/upload/initialize`, accessToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      media_type: kind.mediaType,
      media_category: kind.mediaCategory,
      total_bytes: data.length,
    }),
  });
  const mediaId = init.data?.id;
  // media_key is for the analytics endpoints; media_ids on POST /2/tweets wants id.
  if (!mediaId) throw new Error(`X media initialize: no media id in response`);

  const filename = basename(mediaPath);
  for (let i = 0; i < segments; i++) {
    const chunk = data.subarray(i * X_CHUNK_BYTES, Math.min((i + 1) * X_CHUNK_BYTES, data.length));
    const form = new FormData();
    form.append("media", new Blob([chunk], { type: kind.mediaType }), filename);
    form.append("segment_index", String(i));
    // No explicit content-type: fetch sets multipart/form-data with the boundary.
    await xMediaRequest(`append segment ${i}`, `${API_BASE}/2/media/upload/${mediaId}/append`, accessToken, {
      method: "POST",
      body: form,
    });
  }

  const fin = await xMediaRequest("finalize", `${API_BASE}/2/media/upload/${mediaId}/finalize`, accessToken, {
    method: "POST",
  });
  // Images come back with no processing_info at all; only transcoded media does.
  const info = fin.data?.processing_info;
  if (info && info.state !== "succeeded") {
    await xWaitForProcessing(mediaId, info, accessToken);
  }
  return mediaId;
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

export function xVerifyWebhookSignature(raw: string, headers: Record<string, string>): boolean {
  // X CRC/account activity webhooks sign the body with a consumer secret.
  const secret = process.env.X_CLIENT_SECRET ?? "";
  return secret.length > 0 && verifyHmacHeader(secret, raw, headers["x-twitter-webhooks-signature"] ?? headers["signature"]);
}

export function xParseWebhookEvent(raw: string, _headers: Record<string, string>): { challenge?: string } {
  try {
    const j = JSON.parse(raw) as { challenge?: string };
    return { challenge: j.challenge };
  } catch {
    return {};
  }
}
