// URL validation helpers used where user/operator-supplied URLs reach
// outbound network calls (Mastodon instance URL, Bluesky PDS, webhooks).

import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]", "metadata.google.internal"]);

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 0) return false;
  // IPv6
  if (ip.includes(":")) {
    return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb") || ip === "::" || ip.startsWith("::ffff:");
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0 ||
    a >= 224
  );
}

/**
 * Validate an outbound URL: https-only, no userinfo, no private/loopback
 * hosts (SSRF guard). Throws with a clear message when invalid.
 */
export function assertSafeOutboundUrl(raw: string, label: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${label}: invalid URL`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`${label}: only https:// URLs are allowed`);
  }
  if (u.username || u.password) {
    throw new Error(`${label}: URL must not contain credentials`);
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`${label}: local/loopback hosts are not allowed`);
  }
  if (isPrivateIp(host)) {
    throw new Error(`${label}: private/loopback IP addresses are not allowed`);
  }
  return u;
}
