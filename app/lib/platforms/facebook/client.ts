// Facebook Pages via Meta Graph API
// https://developers.facebook.com/docs/pages-api/
//
// Setup:
//   1. developers.facebook.com → create app type "Business"
//   2. Add "Pages" product + "pages_manage_posts" + "pages_read_engagement" + "pages_show_list"
//   3. User must grant pages_manage_posts via OAuth
//   4. Exchange short-lived → long-lived page access token
//   5. In this app: Accounts → Add → facebook, paste PAGE access token + page id
//
// Posting: POST /{page-id}/feed with message (or /photos for image, /videos for video)

import type { EncryptedCreds } from "../types";
import { verifyHubSignature } from "../../security/webhook";

const GRAPH = "https://graph.facebook.com/v21.0";

export function getFacebookEnv(): { appId: string; appSecret: string; redirectUri: string } {
  const appId = process.env.FACEBOOK_APP_ID ?? process.env.INSTAGRAM_APP_ID ?? "";
  const appSecret = process.env.FACEBOOK_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET ?? "";
  const redirectUri = `${process.env.SOCMED_BASE_URL ?? "http://localhost:3000"}/api/accounts/oauth/callback/facebook`;
  if (!appId || !appSecret) {
    throw new Error("FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be set (or reuse INSTAGRAM_APP_ID/SECRET)");
  }
  return { appId, appSecret, redirectUri };
}

export async function facebookBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { appId, redirectUri } = getFacebookEnv();
  const { randomBytes } = await import("node:crypto");
  const state = randomBytes(16).toString("base64url");
  const url = new URL(`${GRAPH}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_engagement,publish_to_groups");
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  return { authUrl: url.toString(), state };
}

interface FacebookTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export async function facebookCompleteOAuth(code: string): Promise<EncryptedCreds> {
  const { appId, appSecret, redirectUri } = getFacebookEnv();
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Facebook token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as FacebookTokenResponse;
  return {
    accessToken: j.access_token,
    expiresAt: j.expires_in ? Math.floor(Date.now() / 1000) + j.expires_in : undefined,
  };
}

// Exchange a user token for a long-lived one (~60 days)
export async function facebookExchangeLongLived(shortToken: string): Promise<EncryptedCreds> {
  const { appId, appSecret } = getFacebookEnv();
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Facebook long-lived: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as FacebookTokenResponse;
  return {
    accessToken: j.access_token,
    expiresAt: j.expires_in ? Math.floor(Date.now() / 1000) + j.expires_in : undefined,
  };
}

export async function facebookListPages(userToken: string): Promise<Array<{ id: string; name: string; access_token: string }>> {
  const url = new URL(`${GRAPH}/me/accounts`);
  url.searchParams.set("access_token", userToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Facebook /me/accounts: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { data: Array<{ id: string; name: string; access_token: string }> };
  return j.data;
}

export async function facebookPostToPage(
  pageId: string,
  pageAccessToken: string,
  message: string,
  link?: string,
): Promise<{ id: string; url: string }> {
  const url = new URL(`${GRAPH}/${pageId}/feed`);
  url.searchParams.set("message", message);
  url.searchParams.set("access_token", pageAccessToken);
  if (link) url.searchParams.set("link", link);
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`Facebook /feed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return { id: j.id, url: `https://facebook.com/${j.id}` };
}

export async function facebookPostPhotoToPage(
  pageId: string,
  pageAccessToken: string,
  imagePath: string,
  caption?: string,
): Promise<{ id: string; url: string }> {
  const { readFile } = await import("node:fs/promises");
  const { basename } = await import("node:path");
  const data = await readFile(imagePath);
  const form = new FormData();
  form.append("access_token", pageAccessToken);
  form.append("source", new Blob([data]), basename(imagePath));
  if (caption) form.append("caption", caption);
  const res = await fetch(`${GRAPH}/${pageId}/photos`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Facebook /photos: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string; post_id?: string };
  const postId = j.post_id ?? j.id;
  return { id: postId, url: `https://facebook.com/${postId}` };
}

export async function facebookDeletePost(postId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${postId}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Facebook delete: ${res.status} ${await res.text()}`);
  }
}

export async function facebookFetchPageInsights(
  pageId: string,
  pageAccessToken: string,
): Promise<{ impressions: number; engaged: number; comments: number; reactions: number }> {
  const url = new URL(`${GRAPH}/${pageId}/insights`);
  url.searchParams.set("metric", "page_impressions,page_post_engagements,page_consumptions");
  url.searchParams.set("period", "day");
  url.searchParams.set("access_token", pageAccessToken);
  const res = await fetch(url.toString());
  if (!res.ok) return { impressions: 0, engaged: 0, comments: 0, reactions: 0 };
  const j = (await res.json()) as { data: Array<{ name: string; values: Array<{ value: number }> }> };
  const get = (n: string): number => j.data.find((d) => d.name === n)?.values?.[0]?.value ?? 0;
  return { impressions: get("page_impressions"), engaged: get("page_post_engagements"), comments: 0, reactions: 0 };
}

export async function facebookFetchPostInsights(
  postId: string,
  accessToken: string,
): Promise<{ impressions: number; reach: number; engaged: number; reactions: number; comments: number; shares: number }> {
  const url = new URL(`${GRAPH}/${postId}/insights`);
  url.searchParams.set("metric", "post_impressions,post_impressions_unique,post_engaged_users,post_reactions_by_type_total,post_clicks");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) return { impressions: 0, reach: 0, engaged: 0, reactions: 0, comments: 0, shares: 0 };
  const j = (await res.json()) as { data: Array<{ name: string; values: Array<{ value: number | Record<string, number> }> }> };
  const get = (n: string): number => {
    const v = j.data.find((d) => d.name === n)?.values?.[0]?.value;
    if (typeof v === "number") return v;
    if (typeof v === "object" && v) return Object.values(v).reduce((a, b) => a + b, 0);
    return 0;
  };
  return {
    impressions: get("post_impressions"),
    reach: get("post_impressions_unique"),
    engaged: get("post_engaged_users"),
    reactions: get("post_reactions_by_type_total"),
    comments: 0,
    shares: get("post_clicks"),
  };
}

export async function facebookFetchComments(
  postId: string,
  accessToken: string,
  since: number,
): Promise<Array<{ id: string; from_name: string; message: string; created_time: string }>> {
  const url = new URL(`${GRAPH}/${postId}/comments`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "id,from,message,created_time");
  url.searchParams.set("since", String(since));
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const j = (await res.json()) as { data: Array<{ id: string; from: { name: string }; message: string; created_time: string }> };
  return j.data.map((c) => ({ id: c.id, from_name: c.from.name, message: c.message, created_time: c.created_time }));
}

export async function facebookReplyToComment(
  commentId: string,
  message: string,
  accessToken: string,
): Promise<{ id: string }> {
  const url = new URL(`${GRAPH}/${commentId}/comments`);
  url.searchParams.set("message", message);
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`Facebook reply: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return { id: j.id };
}

export function facebookVerifyWebhookSignature(raw: string, headers: Record<string, string>): boolean {
  // X-Hub-Signature-256: sha256=<hmac of raw body with the app secret>
  const secret = process.env.FACEBOOK_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET ?? "";
  return secret.length > 0 && verifyHubSignature(secret, raw, headers["x-hub-signature-256"]);
}

export function facebookParseWebhookEvent(raw: string, _headers: Record<string, string>): { challenge?: string } {
  try {
    const j = JSON.parse(raw) as { challenge?: string };
    return { challenge: j.challenge };
  } catch { return {}; }
}

// followers_count is the modern field; fan_count is the legacy "likes" number
// and on New Page Experience pages simply mirrors followers_count.
// https://developers.facebook.com/docs/graph-api/reference/page/
export async function facebookFetchAudience(
  pageId: string,
  accessToken: string,
): Promise<{ followers?: number; raw?: unknown }> {
  const url = new URL(`${GRAPH}/${pageId}`);
  url.searchParams.set("fields", "followers_count,fan_count");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Facebook audience: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { followers_count?: number; fan_count?: number };
  return { followers: j.followers_count ?? j.fan_count, raw: j };
}
