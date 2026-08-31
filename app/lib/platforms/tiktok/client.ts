// TikTok Login Kit + Content Posting API
//
// Docs:
//   Login Kit (web):   https://developers.tiktok.com/doc/login-kit-web
//   Upload to inbox:   https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
//   Direct post:       https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
//   Creator info:      https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
//   Post status:       https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
//   Media transfer:    https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
//
// Two distinct hosts, do not mix them up:
//   - www.tiktok.com      -> the user-facing OAuth *authorize* page (Login Kit)
//   - open.tiktokapis.com -> every server-to-server call (token, publish, status)
//
// Two publish flows exist, and which one you may use depends on app review:
//   - "upload to inbox" (/v2/post/publish/inbox/video/init/, scope video.upload):
//     lands the video as a draft in the creator's TikTok inbox; they finish and
//     caption it in the app. Needs no app audit, so this is our default.
//   - "direct post" (/v2/post/publish/video/init/, scope video.publish): publishes
//     straight to the profile with our own title/privacy settings. Available, but
//     opt-in: an unaudited client that asks for anything other than SELF_ONLY is
//     rejected with `unaudited_client_can_only_post_to_private_accounts`.

import { createHash, randomBytes } from "node:crypto";
import type { EncryptedCreds } from "../types";
import { verifyHmacHeader } from "../../security/webhook";

const API_BASE = "https://open.tiktokapis.com";
// Login Kit authorize lives on the main web host, NOT on the open-api host.
const AUTH_BASE = "https://www.tiktok.com";

// Media transfer guide: "Each chunk must be at least 5 MB but no greater than
// 64 MB, except for the final chunk, which can be greater than chunk_size (up
// to 128 MB)". Videos under MIN_CHUNK_BYTES must go up as a single whole chunk.
const MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const MAX_CHUNK_COUNT = 1000;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
// 10 MB keeps request count low for typical short-form videos while staying
// inside [5 MB, 64 MB]. Raised automatically if a file would exceed 1000 chunks.
const DEFAULT_CHUNK_BYTES = 10 * 1024 * 1024;

export type TikTokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export interface TikTokCreatorInfo {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: TikTokPrivacyLevel[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

export interface TikTokPublishOptions {
  // false (default) -> upload to inbox as a draft; no app audit required.
  // true -> direct post to the profile; requires the video.publish scope and,
  // for anything but SELF_ONLY, an audited app.
  directPost?: boolean;
  // Only used when directPost is true. Defaults to the safest option that the
  // creator actually has available (SELF_ONLY), which is also the only one an
  // unaudited client is allowed to use.
  privacyLevel?: TikTokPrivacyLevel;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  videoCoverTimestampMs?: number;
  // Wait for TikTok to finish ingesting before returning. On by default so a
  // failed transcode surfaces as a publish error instead of a silent success.
  awaitStatus?: boolean;
}

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string; logid?: string };
}

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
  const verifier = randomBytes(32).toString("base64url");
  // TikTok is the odd one out here: it wants "hex encoding of SHA256" for the
  // S256 challenge, not the base64url of RFC 7636 that every other provider uses.
  const challenge = createHash("sha256").update(verifier).digest("hex");
  return { verifier, challenge };
}

export async function tiktokBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { clientKey, redirectUri } = getTikTokEnv();
  const { verifier, challenge } = tiktokGeneratePkce();
  const state = verifier;
  const url = new URL(`${AUTH_BASE}/v2/auth/authorize/`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("redirect_uri", redirectUri);
  // video.upload covers the inbox/draft flow; video.publish is only exercised
  // once the app is audited and direct post is switched on.
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

// TikTok answers HTTP 200 with a populated `error.code` for most business
// failures, so a non-ok status is not enough to detect a problem.
async function tiktokPost<T>(path: string, accessToken: string, body: unknown, label: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`TikTok ${label}: ${res.status} ${text}`);
  let parsed: TikTokEnvelope<T>;
  try {
    parsed = JSON.parse(text) as TikTokEnvelope<T>;
  } catch {
    throw new Error(`TikTok ${label}: unparseable response ${text.slice(0, 500)}`);
  }
  const code = parsed.error?.code;
  if (code && code !== "ok") {
    const logId = parsed.error?.log_id ?? parsed.error?.logid ?? "";
    throw new Error(`TikTok ${label}: ${code} ${parsed.error?.message ?? ""}${logId ? ` (log_id ${logId})` : ""}`);
  }
  if (!parsed.data) throw new Error(`TikTok ${label}: response had no data`);
  return parsed.data;
}

export async function tiktokQueryCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
  // Required before a direct post: TikTok mandates using the freshly returned
  // privacy options and interaction toggles rather than assuming defaults.
  return tiktokPost<TikTokCreatorInfo>("/v2/post/publish/creator_info/query/", accessToken, {}, "creator_info");
}

export async function tiktokFetchPublishStatus(
  publishId: string,
  accessToken: string,
): Promise<{ status: string; fail_reason?: string; publicaly_available_post_id?: number[]; uploaded_bytes?: number }> {
  return tiktokPost("/v2/post/publish/status/fetch/", accessToken, { publish_id: publishId }, "status/fetch");
}

function mimeForVideo(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  // TikTok only accepts video/mp4, video/quicktime and video/webm on the upload
  // PUT, so anything else is sent as mp4 rather than application/octet-stream.
  return "video/mp4";
}

interface ChunkPlan {
  chunkSize: number;
  totalChunkCount: number;
}

// Per the media transfer guide:
//   - a file under 5 MB must be uploaded whole, with chunk_size == video_size
//   - otherwise each chunk is 5-64 MB, and total_chunk_count is
//     floor(video_size / chunk_size) (1..1000)
//   - the trailing bytes ride along on the final chunk, which may therefore
//     exceed chunk_size (up to 128 MB) -- capping chunk_size at 64 MB keeps the
//     final chunk (< 2 * chunk_size) inside that 128 MB ceiling automatically
export function tiktokPlanChunks(videoSize: number): ChunkPlan {
  if (videoSize <= 0) throw new Error("TikTok: video file is empty");
  if (videoSize > MAX_VIDEO_BYTES) {
    throw new Error(`TikTok: video is ${videoSize} bytes, over the 4GB limit`);
  }
  // Under the 5 MB floor, or under one whole default chunk: send the file as a
  // single chunk with chunk_size == video_size. Declaring a chunk_size larger
  // than the file would make floor(video_size / chunk_size) come out as 0.
  if (videoSize < MIN_CHUNK_BYTES || videoSize < DEFAULT_CHUNK_BYTES) {
    return { chunkSize: videoSize, totalChunkCount: 1 };
  }
  let chunkSize = DEFAULT_CHUNK_BYTES;
  let totalChunkCount = Math.floor(videoSize / chunkSize);
  if (totalChunkCount > MAX_CHUNK_COUNT) {
    // Ceil so the count lands at or under 1000; MAX_CHUNK_BYTES is never
    // exceeded because 4GB / 1000 is well under 64 MB.
    chunkSize = Math.min(MAX_CHUNK_BYTES, Math.ceil(videoSize / MAX_CHUNK_COUNT));
    totalChunkCount = Math.floor(videoSize / chunkSize);
  }
  return { chunkSize, totalChunkCount };
}

async function tiktokUploadChunks(
  uploadUrl: string,
  data: Buffer,
  plan: ChunkPlan,
  contentType: string,
): Promise<void> {
  const total = data.length;
  for (let i = 0; i < plan.totalChunkCount; i++) {
    const first = i * plan.chunkSize;
    // Last chunk absorbs the remainder, so it can be larger than chunkSize.
    const last = i === plan.totalChunkCount - 1 ? total - 1 : first + plan.chunkSize - 1;
    const slice = data.subarray(first, last + 1);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": contentType,
        "content-length": String(slice.length),
        "content-range": `bytes ${first}-${last}/${total}`,
      },
      body: new Uint8Array(slice),
    });
    if (!res.ok) {
      throw new Error(`TikTok chunk ${i + 1}/${plan.totalChunkCount}: ${res.status} ${await res.text()}`);
    }
  }
}

async function tiktokAwaitPublish(
  publishId: string,
  accessToken: string,
): Promise<{ status: string; postId?: string }> {
  // status/fetch is capped at 30 requests/min per token; 3s spacing over ~2min
  // stays well inside that while covering typical transcode times.
  const intervalMs = 3000;
  const attempts = 40;
  let lastStatus = "";
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const s = await tiktokFetchPublishStatus(publishId, accessToken);
    lastStatus = s.status;
    if (s.status === "FAILED") {
      throw new Error(`TikTok publish failed: ${s.fail_reason ?? "unknown reason"}`);
    }
    if (s.status === "SEND_TO_USER_INBOX" || s.status === "PUBLISH_COMPLETE") {
      const postId = s.publicaly_available_post_id?.[0];
      return { status: s.status, postId: postId === undefined ? undefined : String(postId) };
    }
  }
  // Still transcoding is not a failure -- the draft/post will land on its own.
  return { status: lastStatus || "PROCESSING_UPLOAD" };
}

export async function tiktokPublishVideo(
  mediaPath: string,
  caption: string,
  accessToken: string,
  options: TikTokPublishOptions = {},
): Promise<{ id: string; url: string }> {
  const { readFile, stat } = await import("node:fs/promises");
  const stats = await stat(mediaPath);
  const plan = tiktokPlanChunks(stats.size);
  const contentType = mimeForVideo(mediaPath);

  let initPath = "/v2/post/publish/inbox/video/init/";
  let initBody: Record<string, unknown> = {
    source_info: {
      source: "FILE_UPLOAD",
      video_size: stats.size,
      chunk_size: plan.chunkSize,
      total_chunk_count: plan.totalChunkCount,
    },
  };
  let creatorUsername = "";

  if (options.directPost) {
    // Direct post requires a fresh creator_info read: it tells us which privacy
    // levels this account actually offers and whether comment/duet/stitch are
    // force-disabled, both of which TikTok validates against the init payload.
    const info = await tiktokQueryCreatorInfo(accessToken);
    creatorUsername = info.creator_username ?? "";
    const requested = options.privacyLevel;
    const allowed = info.privacy_level_options ?? [];
    // Fail loudly instead of silently downgrading: publishing SELF_ONLY when the
    // caller asked for PUBLIC_TO_EVERYONE would look like success but reach nobody.
    if (requested && allowed.length > 0 && !allowed.includes(requested)) {
      throw new Error(
        `TikTok: privacy_level ${requested} not available for this account (allowed: ${allowed.join(", ")})`,
      );
    }
    // SELF_ONLY is always among the options and is the only level an unaudited
    // client may use, so it is the default when the caller does not pick one.
    const privacyLevel: TikTokPrivacyLevel = requested ?? "SELF_ONLY";
    initPath = "/v2/post/publish/video/init/";
    initBody = {
      post_info: {
        title: caption.slice(0, 2200),
        privacy_level: privacyLevel,
        // Sending `false` where TikTok reports the interaction as disabled is
        // rejected, so mirror the creator's settings unless we are told to
        // disable something explicitly.
        disable_comment: options.disableComment ?? info.comment_disabled ?? false,
        disable_duet: options.disableDuet ?? info.duet_disabled ?? false,
        disable_stitch: options.disableStitch ?? info.stitch_disabled ?? false,
        video_cover_timestamp_ms: options.videoCoverTimestampMs ?? 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: stats.size,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount,
      },
    };
  }

  const init = await tiktokPost<{ publish_id: string; upload_url: string }>(
    initPath,
    accessToken,
    initBody,
    options.directPost ? "video/init" : "inbox/video/init",
  );
  if (!init.upload_url) throw new Error("TikTok: init returned no upload_url");

  const data = await readFile(mediaPath);
  // upload_url is only valid for one hour from issuance.
  await tiktokUploadChunks(init.upload_url, data, plan, contentType);

  let postId: string | undefined;
  if (options.awaitStatus !== false) {
    const result = await tiktokAwaitPublish(init.publish_id, accessToken);
    postId = result.postId;
  }

  // The inbox flow produces a draft, not a live post, so there is no public URL
  // until the creator finishes it in the app. publicaly_available_post_id only
  // comes back for public direct posts that cleared moderation.
  const url =
    postId && creatorUsername
      ? `https://www.tiktok.com/@${creatorUsername}/video/${postId}`
      : "";
  return { id: postId ?? init.publish_id, url };
}

export function tiktokVerifyWebhookSignature(raw: string, headers: Record<string, string>): boolean {
  const secret = process.env.TIKTOK_CLIENT_SECRET ?? "";
  return secret.length > 0 && verifyHmacHeader(secret, raw, headers["x-webhook-signature"] ?? headers["signature"]);
}

export function tiktokParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } {
  return {};
}
