import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP, RFC 4226 HOTP. Hand-rolled rather than pulled from npm: the
 * whole algorithm is an HMAC plus a truncation, node:crypto already ships the
 * hard part, and a dependency here would sit directly on the login path.
 *
 * SHA-1 / 6 digits / 30s is not a preference — it is what Google Authenticator,
 * Authy, 1Password and the rest actually implement. Anything else silently
 * fails to scan for most users.
 */
export const TOTP_DIGITS = 6;
export const TOTP_STEP_SEC = 30;
// One step either side, i.e. ±30s of clock skew between server and phone.
export const TOTP_WINDOW = 1;

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  // Authenticator apps show the secret in spaced groups and some users paste the
  // padding back in, so both are stripped before decoding.
  const clean = input.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret — the size RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function counterFor(unixSeconds: number): number {
  return Math.floor(unixSeconds / TOTP_STEP_SEC);
}

export function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(buf).digest();
  // Dynamic truncation (RFC 4226 §5.3): low nibble of the last byte picks the
  // 4-byte window, and the high bit is masked off to keep it positive.
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function totpAt(secretBase32: string, unixSeconds: number): string {
  return hotp(base32Decode(secretBase32), counterFor(unixSeconds));
}

export interface TotpVerifyResult {
  ok: boolean;
  /** The counter the code matched, for replay tracking. */
  step?: number;
}

/**
 * Checks a submitted code against the accepted window.
 *
 * `lastUsedStep` is what stops replay: a code stays valid for up to 90 seconds
 * across the skew window, so without it a code shoulder-surfed or captured from
 * a proxy can simply be resent. Callers must persist the returned step.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: { now?: number; lastUsedStep?: number | null } = {},
): TotpVerifyResult {
  const submitted = code.replace(/\s/g, "");
  if (!/^\d+$/.test(submitted) || submitted.length !== TOTP_DIGITS) return { ok: false };

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const current = counterFor(now);
  const secret = base32Decode(secretBase32);

  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    const step = current + drift;
    if (opts.lastUsedStep != null && step <= opts.lastUsedStep) continue;
    const expected = hotp(secret, step);
    // Both are fixed-length digit strings, so lengths always match here.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(submitted))) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

/** otpauth:// URI that authenticator apps consume. */
export function otpauthUri(secretBase32: string, account: string, issuer = "socmed"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
