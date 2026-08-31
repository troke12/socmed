// LinkedIn API — OAuth 2.0, versioned Posts/Images APIs, share statistics.
// https://learn.microsoft.com/en-us/linkedin/marketing/

import type { EncryptedCreds } from "../types";
import { verifyHmacHeader } from "../../security/webhook";

const API_BASE = "https://api.linkedin.com";
// OAuth 2.0 lives on www.linkedin.com, NOT api.linkedin.com. Only /oauth/v2/*
// uses this host; every data call stays on API_BASE.
// https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
const OAUTH_BASE = "https://www.linkedin.com";

// Every /rest/* call must declare an explicit API version in YYYYMM form. LinkedIn
// applies no default: a missing header is an error response, and a sunset version is
// rejected too. Versions are supported for a minimum of one year from release, so this
// constant needs a deliberate bump at least annually.
// https://learn.microsoft.com/en-us/linkedin/marketing/versioning
const LINKEDIN_VERSION = "202608";

// Shared header builder for the versioned (/rest/*) endpoints. Both LinkedIn-Version
// and X-Restli-Protocol-Version are mandatory on all of them, so building them in one
// place keeps posts and images from drifting apart.
function restHeaders(accessToken: string, withJsonBody = true): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "linkedin-version": LINKEDIN_VERSION,
    "x-restli-protocol-version": "2.0.0",
  };
  if (withJsonBody) headers["content-type"] = "application/json";
  return headers;
}

// The Posts API `commentary` field is `little` text, not plain text: the docs require
// every reserved character to be backslash-escaped even when it isn't part of a mention
// or hashtag element, otherwise the post can be rejected. An escaped reserved character
// renders as its literal self, so escaping is render-safe.
//
// '#' is deliberately left unescaped: `HashtagElement ::= '#' SINGLE_WORD` is valid
// little grammar, so a plain "#launch" in a caption still renders as a linked hashtag —
// escaping it would silently downgrade every hashtag our users type into literal text.
// Residual risk: a bare '#' not followed by a word (e.g. "C# ") is not valid grammar and
// could still be rejected.
// https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
function escapeLittleText(text: string): string {
  return text.replace(/([\\|{}@[\]()<>*_~])/g, "\\$1");
}

export function getLinkedInEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.LINKEDIN_CLIENT_ID ?? "";
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET ?? "";
  const redirectUri = `${process.env.SOCMED_BASE_URL ?? "http://localhost:3000"}/api/accounts/oauth/callback/linkedin`;
  if (!clientId || !clientSecret) {
    throw new Error("LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set");
  }
  return { clientId, clientSecret, redirectUri };
}

export async function linkedinBeginOAuth(): Promise<{ authUrl: string; state: string }> {
  const { clientId, redirectUri } = getLinkedInEnv();
  const { randomBytes } = await import("node:crypto");
  const state = randomBytes(16).toString("base64url");
  const url = new URL(`${OAUTH_BASE}/oauth/v2/authorization`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid profile email w_member_social");
  url.searchParams.set("state", state);
  return { authUrl: url.toString(), state };
}

export async function linkedinCompleteOAuth(code: string): Promise<EncryptedCreds> {
  const { clientId, clientSecret, redirectUri } = getLinkedInEnv();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`${OAUTH_BASE}/oauth/v2/accessToken`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`LinkedIn token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
    raw: { scope: j.scope },
  };
}

// Heads up before debugging a refresh failure: programmatic refresh tokens
// (grant_type=refresh_token) are NOT generally available. Per the 3-legged OAuth docs,
// "Programmatic refresh tokens are available for a limited set of partners" — an app
// without that enablement never receives a refresh_token in the first place, and this
// call will fail rather than being a bug on our side. Non-partner apps must send the
// member back through the authorize step (which silently bypasses the consent screen
// while the member is still logged in to linkedin.com and the token has not expired).
// Access tokens are issued with a 60-day lifespan.
// https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
export async function linkedinRefresh(creds: EncryptedCreds): Promise<EncryptedCreds> {
  const { clientId, clientSecret, redirectUri } = getLinkedInEnv();
  if (!creds.refreshToken) throw new Error("LinkedIn: no refresh token");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`${OAUTH_BASE}/oauth/v2/accessToken`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`LinkedIn refresh: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? creds.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + j.expires_in,
  };
}

async function linkedinGetUserUrn(accessToken: string): Promise<string> {
  const res = await fetch(`${API_BASE}/v2/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LinkedIn userinfo: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { sub: string };
  return `urn:li:person:${j.sub}`;
}

interface LinkedInImageInitResponse {
  value: { uploadUrl: string; image: string; uploadUrlExpiresAt?: number };
}

// Images API (replaces the deprecated Assets API registerUpload flow): initialize to get
// a one-shot upload URL plus the urn:li:image:{id} that the post will reference, then PUT
// the raw bytes. SYNCHRONOUS_UPLOAD is not supported here, so the image URN is usable
// immediately as a reference but LinkedIn processes the bytes asynchronously.
// https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
async function linkedinUploadImage(
  mediaPath: string,
  accessToken: string,
  authorUrn: string,
): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { extname } = await import("node:path");
  const data = await readFile(mediaPath);
  const ext = extname(mediaPath).toLowerCase().replace(".", "");
  // Step 1: initialize the upload.
  const initRes = await fetch(`${API_BASE}/rest/images?action=initializeUpload`, {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
  });
  if (!initRes.ok) throw new Error(`LinkedIn image init: ${initRes.status} ${await initRes.text()}`);
  const init = (await initRes.json()) as LinkedInImageInitResponse;
  // Step 2: PUT the bytes to the returned pre-signed DMS URL. That host is not the
  // versioned gateway, so it takes no LinkedIn-Version / rest.li headers.
  const putRes = await fetch(init.value.uploadUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream",
    },
    body: data,
  });
  if (!putRes.ok) throw new Error(`LinkedIn image upload: ${putRes.status} ${await putRes.text()}`);
  return init.value.image;
}

// Posts API (replaces the deprecated /v2/ugcPosts endpoint). Note the flat body shape:
// `commentary` instead of specificContent.shareCommentary.text, and a plain enum string
// for `visibility` instead of the old union wrapper.
// https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
export async function linkedinPublishPost(
  text: string,
  mediaPaths: string[],
  accessToken: string,
): Promise<{ id: string; url: string }> {
  const authorUrn = await linkedinGetUserUrn(accessToken);
  const imageUrns: string[] = [];
  for (const p of mediaPaths) {
    imageUrns.push(await linkedinUploadImage(p, accessToken, authorUrn));
  }
  const body: Record<string, unknown> = {
    author: authorUrn,
    commentary: escapeLittleText(text),
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  // One image goes in content.media; two or more require the separate MultiImage content
  // type (content.multiImage), which the API caps at 20. Omitting `content` entirely is
  // what makes it a text-only post — there is no "NONE" media category any more.
  if (imageUrns.length === 1) {
    body.content = { media: { id: imageUrns[0] } };
  } else if (imageUrns.length > 1) {
    body.content = { multiImage: { images: imageUrns.map((id) => ({ id })) } };
  }
  const res = await fetch(`${API_BASE}/rest/posts`, {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LinkedIn post: ${res.status} ${await res.text()}`);
  // The 201 returns the new URN (urn:li:share:… or urn:li:ugcPost:…) ONLY in the
  // x-restli-id response header — the response body is empty, so parsing an `id` out of
  // it silently yields undefined.
  const id = res.headers.get("x-restli-id");
  if (!id) throw new Error("LinkedIn post: 201 without x-restli-id response header");
  return { id, url: `https://www.linkedin.com/feed/update/${id}` };
}

// Must go through /rest/posts, not /v2/ugcPosts: publish now returns whatever URN type
// the Posts API minted, and that can be urn:li:share:… which the legacy ugcPosts path
// cannot address. /rest/posts accepts both ugcPost and share URNs.
export async function linkedinDeletePost(postUrn: string, accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}/rest/posts/${encodeURIComponent(postUrn)}`, {
    method: "DELETE",
    headers: { ...restHeaders(accessToken, false), "x-restli-method": "DELETE" },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`LinkedIn delete: ${res.status} ${await res.text()}`);
  }
}

export async function linkedinFetchMetrics(ugcPostUrn: string, accessToken: string): Promise<{
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
}> {
  const res = await fetch(
    `${API_BASE}/v2/socialActions/${encodeURIComponent(ugcPostUrn)}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return { impressions: 0, likes: 0, comments: 0, shares: 0 };
  const j = (await res.json()) as { likesSummary?: { totalLikes?: number }; commentsSummary?: { totalComments?: number } };
  return {
    impressions: 0,
    likes: j.likesSummary?.totalLikes ?? 0,
    comments: j.commentsSummary?.totalComments ?? 0,
    shares: 0,
  };
}

export function linkedinVerifyWebhookSignature(raw: string, headers: Record<string, string>): boolean {
  const secret = process.env.LINKEDIN_CLIENT_SECRET ?? "";
  return secret.length > 0 && verifyHmacHeader(secret, raw, headers["x-linkedin-signature"] ?? headers["signature"]);
}

export function linkedinParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } {
  return {};
}
