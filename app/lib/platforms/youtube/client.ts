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
// Upload (resumable): two-step — create video resource, then PUT bytes in chunks.
//
// Quota: videos.insert has its own quota bucket, NOT the shared units pool.
// Default allocation is 100 videos.insert calls/day (and separately 100
// search.list calls/day), plus 10,000 units/day combined for every other
// endpoint. So an upload costs 1 unit in the "Video Uploads" bucket — the
// practical ceiling is 100 uploads/day, independent of read/write traffic.
// Daily quotas reset at midnight Pacific Time.
// https://developers.google.com/youtube/v3/getting-started#quota
//
// Auth note: tokens go in the Authorization header, never as an access_token
// query param — URI parameters leak into logs and proxies.
// https://developers.google.com/identity/protocols/oauth2

import { createHash, randomBytes } from "node:crypto";
import type { EncryptedCreds } from "../types";
import { verifyHmacHeader } from "../../security/webhook";

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
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`YouTube channels: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { items?: YouTubeChannel[] };
  if (!j.items || j.items.length === 0) throw new Error("YouTube: no channel found for this account");
  return j.items[0]!;
}

// Chunk size for resumable PUTs. The protocol requires every chunk except the
// last to be a multiple of 256 KB, and all non-final chunks to be the same
// size. 8 MB keeps peak memory bounded (one chunk buffer, not the whole file)
// while staying large enough that per-request overhead stays negligible.
// https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const UPLOAD_MAX_ATTEMPTS = 5;

// Retryable per the protocol: 500, 502, 503, 504 (plus transport-level errors).
// Anything else 4xx/5xx is a permanent failure. 404 specifically means the
// upload session expired and cannot be resumed at all.
function isRetryableUploadStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff with jitter, per Google's resumable-upload guidance.
function backoffDelayMs(attempt: number): number {
  return 2 ** attempt * 1000 + Math.floor(Math.random() * 1000);
}

// "bytes=0-999999" => 1000000 (next byte to send). Absent/unparseable Range
// header means the server has nothing yet, so resume from 0.
function nextOffsetFromRange(rangeHeader: string | null): number {
  if (!rangeHeader) return 0;
  const m = /bytes=\d+-(\d+)/.exec(rangeHeader);
  if (!m?.[1]) return 0;
  return Number(m[1]) + 1;
}

// Step 4.1 of the protocol: empty PUT with `Content-Range: bytes *\/TOTAL`
// asks the server how much it actually received. Returns the completed video
// resource if the upload already finished, otherwise the byte offset to
// resume from. We use this instead of trusting our own counter after a failure
// — the server is the authority on what landed.
async function youtubeQueryUploadStatus(
  uploadUrl: string,
  total: number,
  accessToken: string,
): Promise<{ done: true; id: string } | { done: false; offset: number }> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-range": `bytes */${total}`,
      "content-length": "0",
    },
  });
  if (res.status === 200 || res.status === 201) {
    const j = (await res.json()) as { id: string };
    return { done: true, id: j.id };
  }
  if (res.status === 308) {
    return { done: false, offset: nextOffsetFromRange(res.headers.get("range")) };
  }
  throw new Error(`YouTube upload status: ${res.status} ${await res.text()}`);
}

// Resumable upload:
//   step 1 — POST metadata with X-Upload-Content-Length to get the session URL
//   step 2 — PUT the bytes in fixed-size chunks, each with a Content-Range
//            header; non-final chunks answer 308, the final one answers 201
//            with the video resource.
// The file is read one chunk at a time via a file handle (positional reads),
// so memory stays flat regardless of video size.
export async function youtubeUploadVideo(
  videoPath: string,
  title: string,
  description: string,
  accessToken: string,
  tags: string[] = [],
  privacyStatus: "public" | "unlisted" | "private" = "unlisted",
): Promise<{ id: string; url: string }> {
  const { open, stat } = await import("node:fs/promises");
  const { extname } = await import("node:path");
  const ext = extname(videoPath).toLowerCase().replace(".", "");
  const stats = await stat(videoPath);
  const total = stats.size;
  if (total === 0) throw new Error("YouTube: video file is empty");
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
        "x-upload-content-length": String(total),
        "x-upload-content-type": mime,
      },
      body,
    },
  );
  if (!initRes.ok) throw new Error(`YouTube init upload: ${initRes.status} ${await initRes.text()}`);
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube: no upload URL returned");

  // Step 2: chunked PUTs
  const fh = await open(videoPath, "r");
  try {
    const buf = Buffer.allocUnsafe(UPLOAD_CHUNK_SIZE);
    let offset = 0;
    let attempt = 0;

    while (offset < total) {
      const len = Math.min(UPLOAD_CHUNK_SIZE, total - offset);
      const { bytesRead } = await fh.read(buf, 0, len, offset);
      if (bytesRead === 0) throw new Error("YouTube upload: unexpected EOF reading video file");
      const chunk = buf.subarray(0, bytesRead);
      const last = offset + bytesRead;

      let res: Response;
      try {
        res = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": mime,
            "content-range": `bytes ${offset}-${last - 1}/${total}`,
          },
          body: chunk,
        });
      } catch (err) {
        // Transport failure (dropped connection). Ask the server where it got
        // to, then retry from there rather than blindly re-sending.
        if (++attempt >= UPLOAD_MAX_ATTEMPTS) {
          throw new Error(`YouTube upload: network failure after ${attempt} attempts: ${String(err)}`);
        }
        await sleep(backoffDelayMs(attempt));
        const st = await youtubeQueryUploadStatus(uploadUrl, total, accessToken);
        if (st.done) return { id: st.id, url: `https://www.youtube.com/watch?v=${st.id}` };
        offset = st.offset;
        continue;
      }

      if (res.status === 308) {
        // Non-final chunk accepted. Trust the server's Range over our own
        // arithmetic; it may have accepted only part of the chunk.
        const serverOffset = nextOffsetFromRange(res.headers.get("range"));
        offset = serverOffset > offset ? serverOffset : last;
        attempt = 0;
        continue;
      }

      if (res.status === 200 || res.status === 201) {
        const j = (await res.json()) as { id: string };
        return { id: j.id, url: `https://www.youtube.com/watch?v=${j.id}` };
      }

      if (isRetryableUploadStatus(res.status)) {
        if (++attempt >= UPLOAD_MAX_ATTEMPTS) {
          throw new Error(`YouTube upload: ${res.status} after ${attempt} attempts ${await res.text()}`);
        }
        await sleep(backoffDelayMs(attempt));
        const st = await youtubeQueryUploadStatus(uploadUrl, total, accessToken);
        if (st.done) return { id: st.id, url: `https://www.youtube.com/watch?v=${st.id}` };
        offset = st.offset;
        continue;
      }

      // 404 = session URI expired (a fresh init is required); any other
      // 4xx/5xx is permanent. Neither is resumable, so surface it.
      const detail = await res.text();
      throw new Error(
        res.status === 404
          ? `YouTube upload: session expired (404), upload must be restarted ${detail}`
          : `YouTube upload: ${res.status} ${detail}`,
      );
    }

    // Loop drained without a 2xx: the server holds all bytes but hasn't
    // returned the resource. Ask it explicitly.
    const st = await youtubeQueryUploadStatus(uploadUrl, total, accessToken);
    if (st.done) return { id: st.id, url: `https://www.youtube.com/watch?v=${st.id}` };
    throw new Error("YouTube upload: all bytes sent but server reports upload incomplete");
  } finally {
    await fh.close();
  }
}

export async function youtubeFetchVideoStats(
  videoId: string,
  accessToken: string,
): Promise<{ views: number; likes: number; comments: number }> {
  const url = new URL(`${API}/videos`);
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", videoId);
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
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
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
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
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
  });
  if (!res.ok) throw new Error(`YouTube reply: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return { id: j.id };
}

// A top-level comment is a commentThreads insert, not a comments insert:
// comments.insert requires a parent *comment* id and cannot open a new thread.
// Both videoId and channelId are mandatory on the snippet.
// https://developers.google.com/youtube/v3/docs/commentThreads/insert
export async function youtubeCommentOnVideo(
  videoId: string,
  text: string,
  accessToken: string,
): Promise<{ id: string }> {
  const channel = await youtubeGetMyChannel(accessToken);
  const url = new URL(`${API}/commentThreads`);
  url.searchParams.set("part", "snippet");
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      snippet: {
        videoId,
        channelId: channel.id,
        topLevelComment: { snippet: { textOriginal: text } },
      },
    }),
  });
  if (!res.ok) throw new Error(`YouTube comment: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return { id: j.id };
}

export async function youtubeDeleteVideo(videoId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${API}/videos?id=${encodeURIComponent(videoId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`YouTube delete: ${res.status} ${await res.text()}`);
}

export function youtubeVerifyWebhookSignature(raw: string, headers: Record<string, string>): boolean {
  const secret = process.env.YOUTUBE_CLIENT_SECRET ?? "";
  return secret.length > 0 && verifyHmacHeader(secret, raw, headers["x-youtube-signature"] ?? headers["signature"]);
}
export function youtubeParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } { return {}; }
