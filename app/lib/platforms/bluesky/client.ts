// Bluesky / AT Protocol
// https://docs.bsky.app/docs/api/at-protocol
//
// Auth: identifier (handle or DID) + app password.
// No OAuth — we use createSession RPC.
//
// Posting: com.atproto.repo.createRecord with collection=app.bsky.actor.post
// Media: com.atproto.repo.uploadBlob then embed in record
// Mentions: app.bsky.notification.listNotifications
//
// The handle resolves to a DID via com.atproto.identity.resolveHandle.
// PDS URL is configurable (default https://bsky.social).

import { verifyHmacHeader } from "../../security/webhook";

// Shape of com.atproto.server.createSession / refreshSession output.
// `didDoc` is `type: unknown` in the lexicon; when the server resolved the
// account via its handle it embeds the full DID document, which carries the
// authoritative PDS endpoint — cheaper than a second resolution round-trip.
export interface BlueskySession {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
  didDoc?: unknown;
  active?: boolean;
  status?: string;
}

const DEFAULT_PDS = "https://bsky.social";

// Directory used only to turn a handle into a DID. Any PDS/AppView will answer
// com.atproto.identity.resolveHandle for arbitrary handles, so a fixed host is
// fine here even when the user's own PDS is elsewhere.
const DEFAULT_RESOLVER = "https://public.api.bsky.app";

const stripSlash = (u: string): string => u.replace(/\/$/, "");

export function getBlueskyPDS(rawCreds: Record<string, unknown> | undefined): string {
  const raw = (rawCreds?.raw as { pdsUrl?: string } | undefined) ?? {};
  const url = raw.pdsUrl ?? (rawCreds?.pdsUrl as string | undefined) ?? process.env.BLUESKY_PDS_URL ?? DEFAULT_PDS;
  return stripSlash(url);
}

export async function blueskyCreateSession(
  identifier: string,
  appPassword: string,
  pdsUrl: string = DEFAULT_PDS,
): Promise<BlueskySession> {
  const res = await fetch(`${stripSlash(pdsUrl)}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password: appPassword }),
  });
  if (!res.ok) throw new Error(`Bluesky session: ${res.status} ${await res.text()}`);
  return (await res.json()) as BlueskySession;
}

export async function blueskyRefreshSession(refreshJwt: string, pdsUrl: string): Promise<BlueskySession> {
  // Must authenticate with the refreshJwt here, NOT the accessJwt.
  const res = await fetch(`${stripSlash(pdsUrl)}/xrpc/com.atproto.server.refreshSession`, {
    method: "POST",
    headers: { authorization: `Bearer ${refreshJwt}` },
  });
  if (!res.ok) throw new Error(`Bluesky refresh: ${res.status} ${await res.text()}`);
  return (await res.json()) as BlueskySession;
}

/**
 * Pull the PDS endpoint out of a DID document's service array.
 * Per the atproto DID spec the entry is id `#atproto_pds` (or the fully
 * qualified `did:...#atproto_pds`) with type `AtprotoPersonalDataServer`.
 */
export function blueskyPdsFromDidDoc(didDoc: unknown): string | undefined {
  const services = (didDoc as { service?: unknown } | undefined)?.service;
  if (!Array.isArray(services)) return undefined;
  for (const s of services as Array<{ id?: unknown; type?: unknown; serviceEndpoint?: unknown }>) {
    const id = typeof s.id === "string" ? s.id : "";
    const type = typeof s.type === "string" ? s.type : "";
    const endpoint = typeof s.serviceEndpoint === "string" ? s.serviceEndpoint : "";
    if (!endpoint) continue;
    if (id === "#atproto_pds" || id.endsWith("#atproto_pds") || type === "AtprotoPersonalDataServer") {
      return stripSlash(endpoint);
    }
  }
  return undefined;
}

/** Fetch a DID document for did:plc (plc.directory) or did:web (.well-known). */
export async function blueskyFetchDidDoc(did: string): Promise<unknown> {
  let url: string;
  if (did.startsWith("did:plc:")) {
    url = `${stripSlash(process.env.BLUESKY_PLC_DIRECTORY ?? "https://plc.directory")}/${did}`;
  } else if (did.startsWith("did:web:")) {
    // did:web:example.com            -> https://example.com/.well-known/did.json
    // did:web:example.com:user:alice -> https://example.com/user/alice/did.json
    const parts = did.slice("did:web:".length).split(":").map(decodeURIComponent);
    const host = parts[0];
    if (!host) throw new Error(`Bluesky: malformed did:web ${did}`);
    const path = parts.slice(1);
    url = path.length === 0
      ? `https://${host}/.well-known/did.json`
      : `https://${host}/${path.join("/")}/did.json`;
  } else {
    throw new Error(`Bluesky: unsupported DID method ${did}`);
  }
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Bluesky DID doc: ${res.status} ${await res.text()}`);
  return (await res.json()) as unknown;
}

/**
 * Resolve an account's identity to `{ did, pdsUrl }`.
 * Accepts either a handle or a DID; handles go through resolveHandle against a
 * fixed directory first. This is what makes self-hosted / non-bsky.social PDSes
 * work — bsky.social is not the right host for those accounts.
 */
export async function blueskyResolveIdentity(handleOrDid: string): Promise<{ did: string; pdsUrl: string }> {
  const resolver = stripSlash(process.env.BLUESKY_HANDLE_RESOLVER ?? DEFAULT_RESOLVER);
  const did = handleOrDid.startsWith("did:")
    ? handleOrDid
    : await blueskyResolveHandle(resolver, handleOrDid);
  const doc = await blueskyFetchDidDoc(did);
  const pdsUrl = blueskyPdsFromDidDoc(doc);
  if (!pdsUrl) throw new Error(`Bluesky: no #atproto_pds service entry in DID document for ${did}`);
  return { did, pdsUrl };
}

export type BlueskyBlob = { ref: { $link: string }; mimeType: string; size: number };

export function blueskyIsVideoPath(filePath: string): boolean {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  return ["mp4", "mov"].includes(ext);
}

// Only for images/gifs — video must go through blueskyUploadVideo (below),
// a different service (video.bsky.app) with async transcoding. Wrapping a
// video blob in an app.bsky.embed.images record (the previous bug here)
// produces a record the AppView can't render.
export async function blueskyUploadBlob(
  pdsUrl: string,
  accessJwt: string,
  filePath: string,
): Promise<BlueskyBlob> {
  const { readFile } = await import("node:fs/promises");
  const { extname } = await import("node:path");
  const data = await readFile(filePath);
  const ext = extname(filePath).toLowerCase().replace(".", "");
  const mime = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext) ? `image/${ext === "jpg" ? "jpeg" : ext}` : "application/octet-stream";
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessJwt}`, "content-type": mime },
    body: data,
  });
  if (!res.ok) throw new Error(`Bluesky upload: ${res.status} ${await res.text()}`);
  return (await res.json()) as BlueskyBlob;
}

interface BlueskyVideoJobStatus {
  jobId: string;
  did: string;
  state: string; // JOB_STATE_CREATED..JOB_STATE_COMPLETED / JOB_STATE_FAILED
  progress?: number;
  blob?: BlueskyBlob;
  error?: string;
  failureCode?: string;
  message?: string;
}

const VIDEO_SERVICE = "https://video.bsky.app";

// video.bsky.app is a separate service from the user's PDS: it needs a
// short-lived, scope-bound "service auth" JWT (com.atproto.server.getServiceAuth)
// rather than the regular session accessJwt. Per the current upload flow, the
// audience is the user's OWN PDS (as a did:web derived from its hostname) and
// the bound method is com.atproto.repo.uploadBlob — NOT the video service's
// DID/method, which is the counter-intuitive part of this flow.
async function blueskyGetVideoServiceAuth(pdsUrl: string, accessJwt: string): Promise<string> {
  const host = new URL(pdsUrl).host;
  const aud = `did:web:${host}`;
  const url = new URL(`${pdsUrl}/xrpc/com.atproto.server.getServiceAuth`);
  url.searchParams.set("aud", aud);
  url.searchParams.set("lxm", "com.atproto.repo.uploadBlob");
  url.searchParams.set("exp", String(Math.floor(Date.now() / 1000) + 60 * 30));
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${accessJwt}` } });
  if (!res.ok) throw new Error(`Bluesky getServiceAuth: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { token: string };
  return j.token;
}

// Uploads + waits for transcoding, returning the finished video blob ref.
// Bluesky posts support exactly one video (no mixing with images).
export async function blueskyUploadVideo(
  pdsUrl: string,
  accessJwt: string,
  did: string,
  filePath: string,
  { pollIntervalMs = 2000, timeoutMs = 5 * 60_000 }: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<BlueskyBlob> {
  const { readFile } = await import("node:fs/promises");
  const { basename } = await import("node:path");
  const data = await readFile(filePath);
  const serviceToken = await blueskyGetVideoServiceAuth(pdsUrl, accessJwt);

  const uploadUrl = new URL(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo`);
  uploadUrl.searchParams.set("did", did);
  uploadUrl.searchParams.set("name", basename(filePath));
  const uploadRes = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceToken}`,
      "content-type": "video/mp4",
      "content-length": String(data.byteLength),
    },
    body: data,
  });
  if (!uploadRes.ok) throw new Error(`Bluesky video upload: ${uploadRes.status} ${await uploadRes.text()}`);
  let status = ((await uploadRes.json()) as { jobStatus: BlueskyVideoJobStatus }).jobStatus;

  const deadline = Date.now() + timeoutMs;
  while (!status.blob && status.state !== "JOB_STATE_FAILED") {
    if (Date.now() > deadline) {
      throw new Error(`Bluesky video processing timed out (last state: ${status.state}, ${status.progress ?? 0}%)`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const jobUrl = new URL(`${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus`);
    jobUrl.searchParams.set("jobId", status.jobId);
    const jobRes = await fetch(jobUrl.toString());
    if (!jobRes.ok) throw new Error(`Bluesky video job status: ${jobRes.status} ${await jobRes.text()}`);
    status = ((await jobRes.json()) as { jobStatus: BlueskyVideoJobStatus }).jobStatus;
  }
  if (!status.blob) {
    throw new Error(`Bluesky video processing failed: ${status.failureCode ?? status.error ?? "unknown"} ${status.message ?? ""}`);
  }
  return status.blob;
}

export type BlueskyEmbed =
  | { kind: "images"; images: BlueskyBlob[] } // up to 4 per app.bsky.embed.images
  | { kind: "video"; video: BlueskyBlob };     // exactly 1 — no mixing with images

export async function blueskyCreatePost(
  pdsUrl: string,
  accessJwt: string,
  did: string,
  text: string,
  options: { embed?: BlueskyEmbed; replyTo?: { uri: string; cid: string } } = {},
): Promise<{ uri: string; cid: string; url: string }> {
  const record: Record<string, unknown> = {
    text,
    createdAt: new Date().toISOString(),
    $type: "app.bsky.feed.post",
  };
  if (options.embed?.kind === "images") {
    record.embed = {
      $type: "app.bsky.embed.images",
      images: options.embed.images.slice(0, 4).map((image) => ({ image, alt: "" })),
    };
  } else if (options.embed?.kind === "video") {
    record.embed = { $type: "app.bsky.embed.video", video: options.embed.video };
  }
  if (options.replyTo) {
    record.reply = {
      root: { uri: options.replyTo.uri, cid: options.replyTo.cid },
      parent: { uri: options.replyTo.uri, cid: options.replyTo.cid },
    };
  }
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessJwt}`, "content-type": "application/json" },
    body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", record }),
  });
  if (!res.ok) throw new Error(`Bluesky post: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { uri: string; cid: string };
  // rkey from at-uri: at://did/app.bsky.feed.post/rkey
  const rkey = j.uri.split("/").pop();
  const handle = did; // we don't have handle here, but the URL is rkey-based
  return { uri: j.uri, cid: j.cid, url: `https://bsky.app/profile/${handle}/post/${rkey}` };
}

export async function blueskyDeletePost(pdsUrl: string, accessJwt: string, did: string, rkey: string): Promise<void> {
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.deleteRecord`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessJwt}`, "content-type": "application/json" },
    body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", rkey }),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Bluesky delete: ${res.status} ${await res.text()}`);
}

export async function blueskyListNotifications(
  pdsUrl: string,
  accessJwt: string,
  since: string | undefined,
): Promise<Array<{
  uri: string;
  cid: string;
  author: { did: string; handle: string };
  record: { text: string; createdAt: string };
  reason: string;
  indexedAt: string;
}>> {
  const url = new URL(`${pdsUrl}/xrpc/app.bsky.notification.listNotifications`);
  url.searchParams.set("limit", "50");
  if (since) url.searchParams.set("since", since);
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${accessJwt}` } });
  if (!res.ok) return [];
  const j = (await res.json()) as { notifications: Array<{
    uri: string;
    cid: string;
    author: { did: string; handle: string };
    record: { text: string; createdAt: string };
    reason: string;
    indexedAt: string;
  }> };
  return j.notifications;
}

export async function blueskyResolveHandle(pdsUrl: string, handle: string): Promise<string> {
  const url = new URL(`${pdsUrl}/xrpc/com.atproto.identity.resolveHandle`);
  url.searchParams.set("handle", handle);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Bluesky resolveHandle: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { did: string };
  return j.did;
}

export function blueskyVerifyWebhookSignature(raw: string, headers: Record<string, string>): boolean {
  const secret = process.env.BLUESKY_WEBHOOK_SECRET ?? "";
  return secret.length > 0 && verifyHmacHeader(secret, raw, headers["x-bluesky-signature"] ?? headers["signature"]);
}
export function blueskyParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } { return {}; }

// profileViewDetailed spells these in camelCase, unlike most of atproto's
// snake_case-looking neighbours.
// https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/actor/defs.json
export async function blueskyFetchAudience(
  pdsUrl: string,
  accessJwt: string,
  actor: string,
): Promise<{ followers?: number; following?: number; posts?: number; raw?: unknown }> {
  const url = new URL(`${stripSlash(pdsUrl)}/xrpc/app.bsky.actor.getProfile`);
  url.searchParams.set("actor", actor);
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${accessJwt}` } });
  if (!res.ok) throw new Error(`Bluesky audience: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as {
    followersCount?: number; followsCount?: number; postsCount?: number;
  };
  return { followers: j.followersCount, following: j.followsCount, posts: j.postsCount, raw: j };
}
