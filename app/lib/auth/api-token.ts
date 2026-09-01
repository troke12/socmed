import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@db/client";
import { apiTokens, type ApiTokenRole } from "@db/schema";

export const TOKEN_PREFIX = "socmed_";
const SECRET_BYTES = 32;
// last_used_at is a write on every request. Coalescing it keeps a busy
// integration from turning each read into a write.
const LAST_USED_THROTTLE_SEC = 60;

export interface IssuedToken {
  /** Shown once, never stored. */
  secret: string;
  prefix: string;
  tokenHash: string;
}

export function hashToken(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function generateToken(): IssuedToken {
  const secret = `${TOKEN_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return {
    secret,
    // Enough to distinguish tokens in a list without narrowing a brute-force
    // search in any meaningful way.
    prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
    tokenHash: hashToken(secret),
  };
}

export interface ApiActor {
  kind: "api_token";
  tokenId: number;
  name: string;
  role: ApiTokenRole;
}

/** Extracts a bearer token from a request, if present. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  const value = rest.join(" ").trim();
  return value || null;
}

/**
 * Resolves a bearer token to an actor, or null if there is no usable token.
 *
 * Returns null rather than throwing for a missing header so callers can fall
 * back to cookie auth. An invalid, revoked or expired token also returns null:
 * distinguishing those in the response would tell an attacker which tokens
 * exist.
 */
export function authenticateApiToken(req: Request): ApiActor | null {
  const secret = bearerToken(req);
  if (!secret) return null;

  const row = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashToken(secret))).get();
  if (!row) return null;
  if (row.revokedAt) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.expiresAt && row.expiresAt <= now) return null;

  if (!row.lastUsedAt || now - row.lastUsedAt >= LAST_USED_THROTTLE_SEC) {
    db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.id)).run();
  }

  return { kind: "api_token", tokenId: row.id, name: row.name, role: row.role };
}
