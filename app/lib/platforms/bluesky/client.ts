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

import { Buffer } from "node:buffer";
import type { EncryptedCreds } from "../types";

export interface BlueskySession {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
  pdsUrl: string;
}

const DEFAULT_PDS = "https://bsky.social";

export function getBlueskyPDS(rawCreds: Record<string, unknown> | undefined): string {
  const url = (rawCreds?.pdsUrl as string | undefined) ?? process.env.BLUESKY_PDS_URL ?? DEFAULT_PDS;
  return url.replace(/\/$/, "");
}

export async function blueskyCreateSession(
  identifier: string,
  appPassword: string,
  pdsUrl: string = DEFAULT_PDS,
): Promise<BlueskySession> {
  const res = await fetch(`${pdsUrl.replace(/\/$/, "")}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password: appPassword }),
  });
  if (!res.ok) throw new Error(`Bluesky session: ${res.status} ${await res.text()}`);
  return (await res.json()) as BlueskySession;
}

export async function blueskyRefreshSession(refreshJwt: string, pdsUrl: string): Promise<{ accessJwt: string; refreshJwt: string }> {
  const res = await fetch(`${pdsUrl.replace(/\/$/, "")}/xrpc/com.atproto.server.refreshSession`, {
    method: "POST",
    headers: { authorization: `Bearer ${refreshJwt}` },
  });
  if (!res.ok) throw new Error(`Bluesky refresh: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { accessJwt: string; refreshJwt: string };
  return { accessJwt: j.accessJwt, refreshJwt: j.refreshJwt };
}

export async function blueskyUploadBlob(
  pdsUrl: string,
  accessJwt: string,
  filePath: string,
): Promise<{ ref: { $link: string }; mimeType: string; size: number }> {
  const { readFile } = await import("node:fs/promises");
  const { extname } = await import("node:path");
  const data = await readFile(filePath);
  const ext = extname(filePath).toLowerCase().replace(".", "");
  const mime = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext) ? `image/${ext === "jpg" ? "jpeg" : ext}` :
               ["mp4", "mov"].includes(ext) ? "video/mp4" : "application/octet-stream";
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessJwt}`, "content-type": mime },
    body: data,
  });
  if (!res.ok) throw new Error(`Bluesky upload: ${res.status} ${await res.text()}`);
  return (await res.json()) as { ref: { $link: string }; mimeType: string; size: number };
}

export async function blueskyCreatePost(
  pdsUrl: string,
  accessJwt: string,
  did: string,
  text: string,
  options: { embed?: { ref: { $link: string }; mimeType: string; size: number }; replyTo?: { uri: string; cid: string } } = {},
): Promise<{ uri: string; cid: string; url: string }> {
  const record: Record<string, unknown> = {
    text,
    createdAt: new Date().toISOString(),
    $type: "app.bsky.feed.post",
  };
  if (options.embed) {
    record.embed = {
      $type: "app.bsky.embed.images",
      images: [{ image: options.embed, alt: "" }],
    };
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

export function blueskyVerifyWebhookSignature(_raw: string, _headers: Record<string, string>): boolean { return true; }
export function blueskyParseWebhookEvent(_raw: string, _headers: Record<string, string>): { challenge?: string } { return {}; }

void Buffer;
