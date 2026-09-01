import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@db/client";
import { shortLinks } from "@db/schema";

// Unambiguous alphabet: no 0/O or 1/l/I, since these end up read aloud and
// typed by hand.
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const SLUG_LENGTH = 7;

export function generateSlug(length = SLUG_LENGTH): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function shortenerEnabled(): boolean {
  const v = (process.env.SOCMED_SHORTEN_LINKS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Public origin the short links are served from. Without it the shortener
 * cannot produce a usable absolute URL, so it stays off rather than emitting
 * links that resolve to nothing.
 */
export function publicOrigin(): string | null {
  const raw = process.env.SOCMED_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export interface ShortenResult {
  url: string;
  slug: string;
}

/**
 * Creates a short link for a target URL. Returns null when shortening is off,
 * no public origin is configured, or the target is not http(s) — in every case
 * the caller should publish the original URL rather than fail.
 */
export function createShortLink(
  targetUrl: string,
  meta: { postId?: number | null; accountId?: number | null } = {},
): ShortenResult | null {
  if (!shortenerEnabled()) return null;
  const origin = publicOrigin();
  if (!origin) return null;
  try {
    const u = new URL(targetUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  } catch {
    return null;
  }

  // Retry on the unique-slug collision rather than trusting 56^7 to never
  // repeat. Three attempts is far beyond what the birthday bound needs.
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = generateSlug();
    try {
      db.insert(shortLinks)
        .values({
          slug,
          targetUrl,
          postId: meta.postId ?? null,
          accountId: meta.accountId ?? null,
          createdAt: Math.floor(Date.now() / 1000),
        })
        .run();
      return { url: `${origin}/s/${slug}`, slug };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("UNIQUE")) throw err;
    }
  }
  return null;
}

export interface ResolvedLink {
  targetUrl: string;
}

/** Resolves a slug and records the click. Returns null for an unknown slug. */
export function resolveAndCount(slug: string): ResolvedLink | null {
  const row = db
    .select({ id: shortLinks.id, targetUrl: shortLinks.targetUrl })
    .from(shortLinks)
    .where(eq(shortLinks.slug, slug))
    .get();
  if (!row) return null;
  // Incremented in SQL so concurrent clicks cannot lose counts to a
  // read-modify-write race.
  db.update(shortLinks)
    .set({ clicks: sql`${shortLinks.clicks} + 1`, lastClickedAt: Math.floor(Date.now() / 1000) })
    .where(eq(shortLinks.id, row.id))
    .run();
  return { targetUrl: row.targetUrl };
}
