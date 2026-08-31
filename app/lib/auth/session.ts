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

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
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
  if (!cookie) return null;
  const dot = cookie.indexOf(".");
  if (dot < 0) return null;
  const body = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  if (!safeEq(sig, sign(body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
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
