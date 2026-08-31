import { createHmac, timingSafeEqual } from "node:crypto";

// Shared webhook signature helpers used by platform clients.

function buf(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

function safeEq(a: string, b: string): boolean {
  const ab = buf(a);
  const bb = buf(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function hmacSha256(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Verify an `X-Hub-Signature-256: sha256=<hex>` header (Meta platforms:
 * Facebook / Instagram / Threads). Constant-time comparison.
 */
export function verifyHubSignature(secret: string, body: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = `sha256=${hmacSha256(secret, body)}`;
  return safeEq(expected, header.trim());
}

/**
 * Verify a plain `X-Webhook-Signature` (or `signature`) HMAC-SHA256 header.
 */
export function verifyHmacHeader(secret: string, body: string, header: string | undefined): boolean {
  if (!header) return false;
  return safeEq(hmacSha256(secret, body), header.trim());
}

/**
 * Generic challenge echo for platform handshakes: returns the challenge
 * string when `verify_token` matches (constant-time) and the mode is
 * "subscribe", otherwise null.
 */
export function resolveHubChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  expectedToken: string,
): string | null {
  if (mode !== "subscribe" || !token || !challenge) return null;
  if (!safeEq(token, expectedToken)) return null;
  return challenge;
}
