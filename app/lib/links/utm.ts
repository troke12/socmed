import type { Platform } from "@db/schema";

export interface UtmOptions {
  source: string;
  medium?: string;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
}

/**
 * Appends UTM parameters to a URL.
 *
 * Parameters the author already put on the link are left alone. Someone who
 * typed ?utm_campaign=spring-sale meant it, and silently overwriting it would
 * break attribution they had set up deliberately.
 *
 * Returns the input unchanged if it is not a parseable http(s) URL rather than
 * throwing — a bad link should not take a publish down with it.
 */
export function applyUtm(raw: string, opts: UtmOptions): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return raw;

  const values: Record<string, string | null | undefined> = {
    utm_source: opts.source,
    utm_medium: opts.medium ?? "social",
    utm_campaign: opts.campaign,
    utm_content: opts.content,
    utm_term: opts.term,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") continue;
    if (url.searchParams.has(key)) continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Default template, overridable per install. */
export function utmDefaults(): { enabled: boolean; medium: string; campaign: string | null } {
  const flag = (process.env.SOCMED_UTM_ENABLED ?? "true").trim().toLowerCase();
  return {
    enabled: flag !== "0" && flag !== "false" && flag !== "no",
    medium: process.env.SOCMED_UTM_MEDIUM?.trim() || "social",
    campaign: process.env.SOCMED_UTM_CAMPAIGN?.trim() || null,
  };
}

/**
 * utm_source for a platform. Kept as an explicit map rather than using the
 * platform id directly so the values match what analytics tools already
 * recognise — "x" alone is meaningless in a GA report, and Meta's tools expect
 * "facebook" and "instagram" spelled out.
 */
const UTM_SOURCE: Record<Platform, string> = {
  tiktok: "tiktok",
  linkedin: "linkedin",
  instagram: "instagram",
  x: "twitter",
  facebook: "facebook",
  threads: "threads",
  youtube: "youtube",
  pinterest: "pinterest",
  reddit: "reddit",
  mastodon: "mastodon",
  bluesky: "bluesky",
  discord: "discord",
};

export function utmSourceFor(platform: Platform): string {
  return UTM_SOURCE[platform] ?? platform;
}
