// LinkedIn API v2 — OAuth 2.0, UGC posts, share statistics.
// https://learn.microsoft.com/en-us/linkedin/marketing/

import type { EncryptedCreds } from "../types";

const API_BASE = "https://api.linkedin.com";

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
  const url = new URL(`${API_BASE}/oauth/v2/authorization`);
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
  const res = await fetch(`${API_BASE}/oauth/v2/accessToken`, {
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
  const res = await fetch(`${API_BASE}/oauth/v2/accessToken`, {
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

interface LinkedInUploadResponse {
  value: { uploadMechanism: { "com.linkedin.api.digitalmedia.UploadArtifact": string }; mediaArtifact: string };
}

async function linkedinUploadMedia(
  mediaPath: string,
  accessToken: string,
  authorUrn: string,
): Promise<string> {
  const { readFile, stat } = await import("node:fs/promises");
  const { extname } = await import("node:path");
  const data = await readFile(mediaPath);
  const s = await stat(mediaPath);
  const ext = extname(mediaPath).toLowerCase().replace(".", "");
  // Step 1: register upload
  const regRes = await fetch(`${API_BASE}/v2/assets?action=registerUpload`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      registerUploadRequest: {
        owner: authorUrn,
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }],
        supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"],
      },
    }),
  });
  if (!regRes.ok) throw new Error(`LinkedIn register upload: ${regRes.status} ${await regRes.text()}`);
  const reg = (await regRes.json()) as LinkedInUploadResponse;
  const uploadUrl = reg.value.uploadMechanism["com.linkedin.api.digitalmedia.UploadArtifact"];
  // Step 2: PUT bytes
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream",
    },
    body: data,
  });
  if (!putRes.ok) throw new Error(`LinkedIn upload: ${putRes.status} ${await putRes.text()}`);
  void s; // silence unused
  return reg.value.mediaArtifact;
}

export async function linkedinPublishPost(
  text: string,
  mediaPaths: string[],
  accessToken: string,
): Promise<{ id: string; url: string }> {
  const authorUrn = await linkedinGetUserUrn(accessToken);
  const mediaArtifacts: string[] = [];
  for (const p of mediaPaths) {
    mediaArtifacts.push(await linkedinUploadMedia(p, accessToken, authorUrn));
  }
  const body: Record<string, unknown> = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: mediaArtifacts.length > 0 ? "IMAGE" : "NONE",
        media: mediaArtifacts.map((a) => ({
          status: "READY",
          description: { text: "" },
          media: a,
          title: { text: "" },
        })),
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };
  const res = await fetch(`${API_BASE}/v2/ugcPosts`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-restli-protocol-version": "2.0.0" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LinkedIn ugcPost: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { id: string };
  return { id: j.id, url: `https://www.linkedin.com/feed/update/${j.id}` };
}

export async function linkedinDeletePost(ugcPostUrn: string, accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v2/ugcPosts/${encodeURIComponent(ugcPostUrn)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}`, "x-restli-protocol-version": "2.0.0" },
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

export function linkedinVerifyWebhookSignature(_raw: string, _headers: Record<string, string>): boolean {
  return true;
}

export function linkedinParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } {
  return {};
}
