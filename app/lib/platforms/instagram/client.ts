// Instagram API with Instagram Login (Business/Creator account required, no
// linked Facebook Page needed).
// https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
//
// Host layout for this flow — three distinct hosts, none of them
// graph.facebook.com (that host belongs to the older "Instagram API with
// Facebook Login" flow, which uses a different scope set entirely):
//   www.instagram.com/oauth/authorize   -> authorization window
//   api.instagram.com/oauth/access_token -> code -> short-lived token
//   graph.instagram.com/...             -> long-lived tokens + all Graph calls
// Tokens minted here are only valid against graph.instagram.com; sending them
// to graph.facebook.com yields "Invalid OAuth access token".

import type { EncryptedCreds } from "../types";
import { verifyHubSignature } from "../../security/webhook";

const IG_API_VERSION = "v25.0";
const AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const TOKEN_EXCHANGE_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH_HOST = "https://graph.instagram.com";
const GRAPH_BASE = `${GRAPH_HOST}/${IG_API_VERSION}`;

const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
  "instagram_business_content_publish",
].join(",");

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
  // Instagram Business Login: unversioned authorize path on www.instagram.com.
  // client_id here is the *Instagram* App ID from the app dashboard's Instagram
  // product, not the Facebook App ID.
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", IG_SCOPES);
  url.searchParams.set("state", state);
  return { authUrl: url.toString(), state };
}

export async function instagramCompleteOAuth(code: string): Promise<EncryptedCreds> {
  const { appId, appSecret, redirectUri } = getInstagramEnv();
  // Step 1: code -> short-lived (1h) token. This one is a POST with a
  // form-encoded body on api.instagram.com, not a GET with query params.
  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(TOKEN_EXCHANGE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Instagram token: ${res.status} ${await res.text()}`);
  // The documented shape is {data:[{access_token,user_id,permissions}]}, but the
  // endpoint has also returned the object unwrapped; accept either.
  const shortLived = (await res.json()) as
    | { access_token: string }
    | { data: Array<{ access_token: string }> };
  const accessToken =
    "data" in shortLived ? shortLived.data[0]?.access_token : shortLived.access_token;
  if (!accessToken) throw new Error("Instagram token: no access_token in response");
  // Step 2: short-lived -> long-lived (60d) token, on graph.instagram.com.
  const llUrl = new URL(`${GRAPH_HOST}/access_token`);
  llUrl.searchParams.set("grant_type", "ig_exchange_token");
  llUrl.searchParams.set("client_secret", appSecret);
  llUrl.searchParams.set("access_token", accessToken);
  const llRes = await fetch(llUrl.toString());
  if (!llRes.ok) throw new Error(`Instagram long-lived: ${llRes.status} ${await llRes.text()}`);
  const ll = (await llRes.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: ll.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + ll.expires_in,
  };
}

export async function instagramRefresh(creds: EncryptedCreds): Promise<EncryptedCreds> {
  // Long-lived tokens are refreshed when they're > 24h old and < 60 days.
  // Unversioned path on graph.instagram.com.
  const url = new URL(`${GRAPH_HOST}/refresh_access_token`);
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
  // `user_id` is the Instagram professional account id (IG_ID) that the
  // /media and /media_publish edges are hung off. `id` on this host is the
  // app-scoped id, which is NOT interchangeable — request both and prefer
  // user_id.
  user_id?: string;
  id?: string;
  username: string;
}

async function igGetMe(accessToken: string): Promise<IgUser> {
  const url = new URL(`${GRAPH_BASE}/me`);
  url.searchParams.set("fields", "user_id,username");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`IG me: ${res.status} ${await res.text()}`);
  return (await res.json()) as IgUser;
}

export async function instagramPublishMedia(
  caption: string,
  mediaPath: string,
  accessToken: string,
): Promise<{ id: string; url: string }> {
  const { extname } = await import("node:path");
  const ext = extname(mediaPath).toLowerCase();
  // Instagram's container API requires a *public* media URL. We mint a
  // signed, expiring URL from this app's media endpoint.
  const { signedMediaUrl } = await import("../../media/url");
  const mediaUrl = signedMediaUrl(mediaPath, 60 * 30);

  // Resolve the IG user id from the token.
  const me = await igGetMe(accessToken);
  const igUserId = me.user_id ?? me.id;
  if (!igUserId) throw new Error("Instagram: could not resolve IG user id from token");

  // Step 1: create a media container. Since Jul 2023 Meta unified single
  // feed video into the Reels object — there is no separate "feed video"
  // media_type. share_to_feed:true asks for feed placement in addition to
  // the Reels tab, though Meta's own docs note neither value guarantees it.
  const isVideo = ext === ".mp4" || ext === ".mov";
  const containerUrl = new URL(`${GRAPH_BASE}/${igUserId}/media`);
  containerUrl.searchParams.set("access_token", accessToken);
  containerUrl.searchParams.set("caption", caption);
  if (isVideo) {
    containerUrl.searchParams.set("media_type", "REELS");
    containerUrl.searchParams.set("video_url", mediaUrl);
    containerUrl.searchParams.set("share_to_feed", "true");
  } else {
    containerUrl.searchParams.set("media_type", "IMAGE");
    containerUrl.searchParams.set("image_url", mediaUrl);
  }
  const containerRes = await fetch(containerUrl.toString(), { method: "POST" });
  if (!containerRes.ok) {
    const text = await containerRes.text();
    // Common Meta error: "Media ID is not valid" when the URL is unreachable.
    throw new Error(`Instagram container: ${containerRes.status} ${text.slice(0, 300)}`);
  }
  const container = (await containerRes.json()) as { id: string };

  // Video containers process asynchronously — publishing before status is
  // FINISHED fails. Images are ready immediately but polling once is a
  // harmless no-op for them, so we don't special-case it out.
  await waitForContainerReady(container.id, accessToken);

  // Step 2: publish the container.
  const publishUrl = new URL(`${GRAPH_BASE}/${igUserId}/media_publish`);
  publishUrl.searchParams.set("creation_id", container.id);
  publishUrl.searchParams.set("access_token", accessToken);
  const publishRes = await fetch(publishUrl.toString(), { method: "POST" });
  if (!publishRes.ok) {
    throw new Error(`Instagram publish: ${publishRes.status} ${(await publishRes.text()).slice(0, 300)}`);
  }
  const j = (await publishRes.json()) as { id: string };

  // Media IDs are not shortcodes, so the URL must come from the `permalink`
  // field rather than being constructed from the id.
  const permalinkUrl = new URL(`${GRAPH_BASE}/${j.id}`);
  permalinkUrl.searchParams.set("fields", "permalink");
  permalinkUrl.searchParams.set("access_token", accessToken);
  const permalinkRes = await fetch(permalinkUrl.toString());
  const permalink = permalinkRes.ok
    ? ((await permalinkRes.json()) as { permalink?: string }).permalink
    : undefined;
  return { id: j.id, url: permalink ?? `https://www.instagram.com/p/${j.id}/` };
}

// Polls container status until FINISHED (or a terminal failure/timeout).
// Images typically report FINISHED on the first check; video processing can
// take from seconds to a few minutes depending on length/size.
async function waitForContainerReady(
  containerId: string,
  accessToken: string,
  { intervalMs = 3000, timeoutMs = 180_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const url = new URL(`${GRAPH_BASE}/${containerId}`);
    url.searchParams.set("fields", "status_code,status");
    url.searchParams.set("access_token", accessToken);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Instagram container status: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { status_code?: string; status?: string };
    if (j.status_code === "FINISHED") return;
    if (j.status_code === "ERROR" || j.status_code === "EXPIRED") {
      throw new Error(`Instagram container failed: ${j.status_code} ${j.status ?? ""}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Instagram container timed out waiting to finish (last status: ${j.status_code ?? "unknown"})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export function instagramVerifyWebhookSignature(raw: string, headers: Record<string, string>): boolean {
  const secret = process.env.INSTAGRAM_APP_SECRET ?? "";
  return secret.length > 0 && verifyHubSignature(secret, raw, headers["x-hub-signature-256"]);
}

export function instagramParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } {
  return {};
}

// Replying to a comment and commenting on a media object are two different
// edges on Instagram — a reply posted to the media edge, or a top-level comment
// posted to the replies edge, is simply the wrong call.
// https://developers.facebook.com/docs/instagram-platform/comment-moderation/
export async function instagramReplyToComment(
  commentId: string,
  message: string,
  accessToken: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${commentId}/replies`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`Instagram reply: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return { id: j.id };
}

// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media/comments/
export async function instagramCommentOnMedia(
  mediaId: string,
  message: string,
  accessToken: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH_BASE}/${mediaId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`Instagram comment: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return { id: j.id };
}
