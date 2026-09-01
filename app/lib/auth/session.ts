import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "./edge";

export { SESSION_COOKIE_NAME, SESSION_MAX_AGE };

function getSecret(): string {
  const s = process.env.SOCMED_COOKIE_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SOCMED_COOKIE_SECRET missing or too short (need >=32 chars)");
  }
  return s;
}

// `kind` is mixed into the signed content, not just the payload. That is what
// keeps a half-authenticated TOTP token from ever verifying as a full session:
// the two HMACs are computed over different strings, so neither token's
// signature validates under the other's parser. Session signing is unchanged
// (kind "") so existing cookies keep working across the upgrade.
function sign(payload: string, kind = ""): string {
  return createHmac("sha256", getSecret())
    .update(kind ? `${kind}.${payload}` : payload)
    .digest("base64url");
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface SessionPayload {
  uid: number;
  exp: number; // unix seconds
}

export function createSessionCookie(uid: number): string {
  const payload: SessionPayload = {
    uid,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function parseSessionCookie(cookie: string | undefined | null): SessionPayload | null {
  return parseSigned<SessionPayload>(cookie, "");
}

// Second-factor handoff. Short-lived on purpose: it stands in for a verified
// password, so it should not outlive the few seconds it takes to read a code
// off a phone.
export const PENDING_TOTP_COOKIE_NAME = "socmed_totp_pending";
export const PENDING_TOTP_MAX_AGE = 5 * 60;
const PENDING_KIND = "totp";

export interface PendingTotpPayload {
  uid: number;
  exp: number;
}

export function createPendingTotpCookie(uid: number): string {
  const payload: PendingTotpPayload = {
    uid,
    exp: Math.floor(Date.now() / 1000) + PENDING_TOTP_MAX_AGE,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, PENDING_KIND)}`;
}

export function parsePendingTotpCookie(cookie: string | undefined | null): PendingTotpPayload | null {
  return parseSigned<PendingTotpPayload>(cookie, PENDING_KIND);
}

function parseSigned<T extends { uid: number; exp: number }>(
  cookie: string | undefined | null,
  kind: string,
): T | null {
  if (!cookie) return null;
  const dot = cookie.indexOf(".");
  if (dot < 0) return null;
  const body = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  if (!safeEq(sig, sign(body, kind))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (typeof payload.uid !== "number" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64");
}
