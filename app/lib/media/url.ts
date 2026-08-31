import { createHmac, timingSafeEqual } from "node:crypto";

// Signed media URLs let platform APIs (Instagram/Threads/Pinterest) fetch
// an uploaded file without a browser session. The signature is an HMAC of
// the path + expiry using the cookie secret, so only the app can mint URLs.

function secret(): string {
  const s = process.env.SOCMED_COOKIE_SECRET;
  if (!s || s.length < 32) throw new Error("SOCMED_COOKIE_SECRET missing or too short");
  return s;
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function signMediaPath(path: string, expiresAt: number): string {
  return createHmac("sha256", secret()).update(`${path}:${expiresAt}`).digest("base64url");
}

export function verifyMediaSignature(path: string, expiresAt: number, sig: string): boolean {
  const expected = signMediaPath(path, expiresAt);
  return safeEq(expected, sig);
}

/** Build a public media URL for a platform to fetch, valid for `ttlSec`. */
export function signedMediaUrl(path: string, ttlSec = 60 * 30): string {
  const base = process.env.SOCMED_BASE_URL ?? "http://localhost:3000";
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = signMediaPath(path, exp);
  return `${base}/api/media?path=${encodeURIComponent(path)}&exp=${exp}&sig=${sig}`;
}
