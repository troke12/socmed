// Mastodon (federated) — instance-based, OAuth 2.0
// https://docs.joinmastodon.org/api/
//
// Each account is tied to a specific instance (e.g. mastodon.social, fosstodon.org).
// Set the instance URL via the `instanceUrl` column on the account.
//
// Posting: POST /api/v1/statuses with status, visibility, media_ids[]
// Media: POST /api/v2/media (4-step: init, upload, update, finalize)

import type { EncryptedCreds } from "../types";
import { verifyHmacHeader } from "../../security/webhook";

function apiBase(instanceUrl: string): string {
  return `${instanceUrl.replace(/\/$/, "")}/api/v1`;
}

export function getMastodonEnv(): { clientId?: string; clientSecret?: string; redirectUri: string } {
  return {
    redirectUri: `${process.env.SOCMED_BASE_URL ?? "http://localhost:3000"}/api/accounts/oauth/callback/mastodon`,
  };
}

// OAuth app is per-instance; we register the app lazily on beginOAuth.
// Each instance has its own client_id/client_secret, stored in raw creds.
//
// Mastodon's POST /api/v1/apps is NOT deduped server-side (mastodon/mastodon#21991) —
// every call creates a brand-new Application record with its own fresh client_id/client_secret.
// beginOAuth and completeOAuth MUST use the same pair for a given instance, because the
// authorization code Mastodon issues is bound to the client_id that started the flow; if
// completeOAuth registers a second app and tries to redeem the code against it, the token
// exchange fails. This in-memory cache makes registration happen once per instance and
// reuses the result across both steps.
//
// Tradeoff: the cache is process-local and in-memory only. That's fine for this app's
// single-instance deployment, but it will NOT survive a process restart between begin and
// complete (the cache resets, so the flow would need to be retried) and it is NOT shared
// across horizontally scaled instances. A DB-backed cache would be needed for either case.
// Acceptable here since the OAuth window is only a few minutes.
const appRegistrationCache = new Map<string, { clientId: string; clientSecret: string }>();

function normalizeInstanceUrl(instanceUrl: string): string {
  return instanceUrl.replace(/\/$/, "").toLowerCase();
}

export async function mastodonRegisterApp(instanceUrl: string, redirectUri: string): Promise<{ clientId: string; clientSecret: string }> {
  const cacheKey = normalizeInstanceUrl(instanceUrl);
  const cached = appRegistrationCache.get(cacheKey);
  if (cached) return cached;

  const body = new URLSearchParams({
    client_name: "socmed",
    redirect_uris: redirectUri,
    scopes: "read write push",
  });
  const res = await fetch(`${instanceUrl.replace(/\/$/, "")}/api/v1/apps`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Mastodon app register: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { client_id: string; client_secret: string };
  const registered = { clientId: j.client_id, clientSecret: j.client_secret };
  appRegistrationCache.set(cacheKey, registered);
  return registered;
}

export async function mastodonBeginOAuth(instanceUrl: string): Promise<{ authUrl: string; state: string }> {
  const { redirectUri } = getMastodonEnv();
  if (!instanceUrl) throw new Error("Mastodon: set instanceUrl in the account (e.g. https://mastodon.social)");
  const { clientId } = await mastodonRegisterApp(instanceUrl, redirectUri);
  const { randomBytes } = await import("node:crypto");
  const state = randomBytes(16).toString("base64url");
  const url = new URL(`${instanceUrl.replace(/\/$/, "")}/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read write push");
  url.searchParams.set("state", state);
  return { authUrl: url.toString(), state };
}

export async function mastodonCompleteOAuth(
  code: string,
  instanceUrl: string,
): Promise<EncryptedCreds> {
  const { redirectUri } = getMastodonEnv();
  const { clientId, clientSecret } = await mastodonRegisterApp(instanceUrl, redirectUri);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${instanceUrl.replace(/\/$/, "")}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Mastodon token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; scope: string; created_at: number };
  return { accessToken: j.access_token, raw: { scope: j.scope, clientId, clientSecret, instanceUrl } };
}

export async function mastodonVerifyCredentials(
  instanceUrl: string,
  accessToken: string,
): Promise<{ id: string; username: string; display_name: string }> {
  const res = await fetch(`${apiBase(instanceUrl)}/accounts/verify_credentials`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Mastodon verify: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; username: string; display_name: string };
}

export async function mastodonUploadMedia(
  instanceUrl: string,
  filePath: string,
  accessToken: string,
  description?: string,
): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { basename, extname } = await import("node:path");
  const data = await readFile(filePath);
  const ext = extname(filePath).toLowerCase().replace(".", "");
  const mime = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext) ? `image/${ext === "jpg" ? "jpeg" : ext}` :
               ["mp4", "mov", "webm"].includes(ext) ? `video/${ext}` : "application/octet-stream";
  const form = new FormData();
  form.append("file", new Blob([data]), basename(filePath));
  if (description) form.append("description", description);
  const res = await fetch(`${instanceUrl.replace(/\/$/, "")}/api/v2/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Mastodon media: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string; url?: string };
  // Wait for processing if video
  if (mime.startsWith("video/")) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const check = await fetch(`${instanceUrl.replace(/\/$/, "")}/api/v1/media/${j.id}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (check.ok) {
        const c = (await check.json()) as { url?: string };
        if (c.url) return j.id;
      }
    }
  }
  return j.id;
}

export async function mastodonPostStatus(
  instanceUrl: string,
  text: string,
  accessToken: string,
  options: { mediaIds?: string[]; visibility?: "public" | "unlisted" | "private" | "direct"; inReplyToId?: string } = {},
): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = {
    status: text,
    visibility: options.visibility ?? "public",
  };
  if (options.mediaIds && options.mediaIds.length > 0) body.media_ids = options.mediaIds;
  if (options.inReplyToId) body.in_reply_to_id = options.inReplyToId;
  const res = await fetch(`${apiBase(instanceUrl)}/statuses`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mastodon post: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string; url: string };
  return { id: j.id, url: j.url };
}

export async function mastodonDeleteStatus(
  instanceUrl: string,
  statusId: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(`${apiBase(instanceUrl)}/statuses/${statusId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Mastodon delete: ${res.status} ${await res.text()}`);
}

export async function mastodonFetchNotifications(
  instanceUrl: string,
  accessToken: string,
  sinceId?: string,
): Promise<Array<{ id: string; type: string; account: { username: string; display_name: string }; status?: { id: string; content: string }; created_at: string }>> {
  const url = new URL(`${apiBase(instanceUrl)}/notifications`);
  url.searchParams.set("limit", "40");
  if (sinceId) url.searchParams.set("since_id", sinceId);
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return [];
  return (await res.json()) as Array<{ id: string; type: string; account: { username: string; display_name: string }; status?: { id: string; content: string }; created_at: string }>;
}

export async function mastodonFetchContext(
  instanceUrl: string,
  statusId: string,
  accessToken: string,
): Promise<{ descendants: Array<{ id: string; account: { username: string }; content: string; created_at: string }> }> {
  const res = await fetch(`${apiBase(instanceUrl)}/statuses/${statusId}/context`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { descendants: [] };
  return (await res.json()) as { descendants: Array<{ id: string; account: { username: string }; content: string; created_at: string }> };
}

export function mastodonVerifyWebhookSignature(raw: string, headers: Record<string, string>): boolean {
  const secret = process.env.MASTODON_WEBHOOK_SECRET ?? "";
  return secret.length > 0 && verifyHmacHeader(secret, raw, headers["x-mastodon-signature"] ?? headers["signature"]);
}
export function mastodonParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } { return {}; }

// https://docs.joinmastodon.org/entities/Account/
export async function mastodonFetchAudience(
  instanceUrl: string,
  accessToken: string,
): Promise<{ followers?: number; following?: number; posts?: number; raw?: unknown }> {
  const res = await fetch(`${apiBase(instanceUrl)}/accounts/verify_credentials`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Mastodon audience: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as {
    followers_count?: number; following_count?: number; statuses_count?: number;
  };
  return {
    followers: j.followers_count,
    following: j.following_count,
    posts: j.statuses_count,
    raw: j,
  };
}
