// Per-platform compose-time content rules (character limits, media
// constraints) — separate from lib/platforms/*/limits.ts (which was about
// API rate limits, a different concern and not currently reintroduced).
//
// These are UX guardrails for the compose screen, not server-side
// enforcement — the platform API is always the final authority and every
// number here can drift as platforms change their rules. Confidence is
// marked per platform:
//   "official"    — read directly from the platform's own current docs/lexicon
//   "approximate" — official docs give a workflow but not the exact number, or
//                   only third-party corroboration was reachable
//   "dynamic"     — the platform exposes the real limit via an API the app
//                   doesn't call yet (e.g. Mastodon's per-instance config);
//                   the number here is a common default used as a fallback
//
// Source citations live next to each platform for anyone updating these.

import type { PlatformId } from "../platform-meta";

export type TextCountUnit = "chars" | "bytes" | "graphemes";

export interface PlatformContentRules {
  confidence: "official" | "approximate" | "dynamic";
  /** How the caption limit is measured. Most platforms count JS string length; some don't. */
  textUnit: TextCountUnit;
  /** Max caption length in `textUnit` units. Omit if impractically large to matter. */
  textLimit?: number;
  /** Fixed cost (in `textUnit` units) charged for a URL regardless of its real length, if the platform shortens links. */
  linkFixedCost?: number;
  maxHashtags?: number;
  maxMentions?: number;
  maxImages?: number;
  maxVideos?: number;
  /** Can one post contain both images and video? Almost universally no. */
  mixedMediaAllowed?: boolean;
  /** Does a post require at least one media item (no text-only posts)? */
  requiresMedia?: boolean;
  imageMaxSizeMB?: number;
  videoMaxSizeMB?: number;
  videoMinDurationSec?: number;
  videoMaxDurationSec?: number;
  /** Short caveats surfaced in the compose UI next to this platform's preview. */
  notes: string[];
}

export const CONTENT_RULES: Record<PlatformId, PlatformContentRules> = {
  x: {
    confidence: "official",
    textUnit: "chars",
    textLimit: 280,
    linkFixedCost: 23, // t.co wraps every URL to this length regardless of actual length
    maxImages: 4,
    maxVideos: 1,
    mixedMediaAllowed: false,
    imageMaxSizeMB: 5,
    videoMaxSizeMB: 512,
    videoMinDurationSec: 0.5,
    videoMaxDurationSec: 140,
    notes: [
      "280 chars for standard accounts (Premium tiers get more, but that's account-specific, not enforced here).",
      "Emoji and other wide characters count as 2 — this counter approximates that.",
      "Exactly one of: up to 4 images, 1 GIF, or 1 video. No mixing images with video.",
    ],
  },
  instagram: {
    confidence: "official",
    textUnit: "chars",
    textLimit: 2200,
    maxHashtags: 30,
    maxMentions: 20,
    maxImages: 10,
    maxVideos: 1, // a carousel's items (image or video) share the 10-item cap; a single post can't mix an image-only feed post with more than one video easily — treated as 1 for the simple non-carousel case
    mixedMediaAllowed: true, // carousels can mix images and video
    requiresMedia: true,
    imageMaxSizeMB: 8,
    videoMaxSizeMB: 300,
    videoMinDurationSec: 3,
    videoMaxDurationSec: 900, // 15 min, Reels
    notes: [
      "No text-only posts — at least one image or video is required.",
      "Carousels: up to 10 items, images and video can mix.",
      "Single feed video is published as a Reel (share_to_feed) — same 3s–15min, 300MB limits.",
    ],
  },
  threads: {
    confidence: "official",
    textUnit: "chars",
    textLimit: 500,
    maxImages: 20,
    maxVideos: 20, // carousel cap is on the combined item count
    mixedMediaAllowed: true,
    videoMaxSizeMB: 1024,
    videoMaxDurationSec: 300,
    notes: ["Carousel: 2–20 images/videos combined.", "Video: up to 5 minutes, 1GB."],
  },
  facebook: {
    confidence: "approximate",
    textUnit: "chars",
    // Facebook's hard technical cap (~63,206 chars) is high enough to not be
    // worth enforcing as a "will be rejected" limit in this UI.
    videoMaxSizeMB: 1536, // 1.5GB, resumable upload path
    videoMaxDurationSec: 2700, // 45 min, resumable upload path
    notes: [
      "No firm official character limit worth enforcing — Facebook's technical cap is very high.",
      "Posts past roughly 400-500 characters get truncated behind \"See more\" in the feed (not an API rule, just a UX heads-up).",
    ],
  },
  linkedin: {
    confidence: "official",
    textUnit: "chars",
    textLimit: 3000,
    maxImages: 20, // 1 via single image, 2-20 via multiImage
    maxVideos: 1,
    mixedMediaAllowed: false,
    videoMaxSizeMB: 500,
    videoMinDurationSec: 3,
    videoMaxDurationSec: 1800,
    notes: [
      "1 image uses a single-image post; 2–20 images become a multi-image post.",
      "Video: 3s–30min, up to 500MB, MP4 only.",
      "Organic posts need an audience of 300+ connections/followers to publish.",
    ],
  },
  tiktok: {
    confidence: "official",
    textUnit: "chars", // UTF-16 code units, close enough to .length for this UI
    textLimit: 2200,
    maxVideos: 1,
    maxImages: 35, // photo-post mode, mutually exclusive with video
    mixedMediaAllowed: false,
    requiresMedia: true,
    imageMaxSizeMB: 20,
    videoMaxSizeMB: 4096,
    videoMinDurationSec: undefined, // not documented for the Content Posting API
    videoMaxDurationSec: 180, // conservative default — many creator accounts cap at 3 min even though the API ceiling is 10 min
    notes: [
      "Video required (or a photo carousel via the separate photo-post mode).",
      "Duration cap varies per creator (some accounts allow up to 10 min) — 3 min shown as a safe default.",
      "Without app audit approval, posts publish as private drafts to the creator's TikTok inbox, not directly to their profile.",
    ],
  },
  youtube: {
    confidence: "official",
    textUnit: "chars",
    textLimit: 100, // title
    maxVideos: 1,
    requiresMedia: true,
    videoMaxDurationSec: 900, // 15 min default for unverified accounts
    notes: [
      "Title: 100 characters. Description: 5000 bytes (not characters — non-ASCII text uses more bytes per character).",
      "`<` and `>` are rejected in both title and description.",
      "15-minute upload limit for unverified accounts; verified accounts can upload much longer video, bounded by 256GB/12h.",
    ],
  },
  pinterest: {
    confidence: "approximate",
    textUnit: "chars",
    textLimit: 500, // description
    maxImages: 1,
    requiresMedia: true,
    notes: [
      "Pinterest requires an image (or video) — text-only pins aren't supported.",
      "Description ~500 chars, title ~100 chars — these figures could not be confirmed against a directly-rendered official page this pass; treat as approximate.",
    ],
  },
  reddit: {
    confidence: "official",
    textUnit: "chars",
    textLimit: 40000, // self-post body; title is the tighter constraint, handled as a separate note
    maxImages: 1,
    requiresMedia: false,
    notes: [
      "Title: 300 characters (shared limit for both link and self posts) — not the same as the body limit shown here.",
      "Self-post body: 40,000 characters.",
    ],
  },
  mastodon: {
    confidence: "dynamic",
    textUnit: "chars",
    textLimit: 500, // instance-configurable default; real limit is discoverable per-instance via GET /api/v2/instance
    linkFixedCost: 23,
    maxImages: 4,
    imageMaxSizeMB: 16,
    videoMaxSizeMB: 99,
    notes: [
      "500 is the common default, but every Mastodon instance can configure its own limit — this app doesn't yet query the connected instance's actual configuration.",
      "URLs are shortened to a fixed cost (23 chars) in the official web client's counter, mirrored here.",
    ],
  },
  bluesky: {
    confidence: "official",
    textUnit: "graphemes", // the tighter of two simultaneous limits (3000 bytes AND 300 graphemes) — grapheme count hits first for most non-emoji-heavy text
    textLimit: 300,
    maxImages: 4,
    maxVideos: 1,
    mixedMediaAllowed: false,
    imageMaxSizeMB: 2,
    videoMaxSizeMB: 300,
    videoMaxDurationSec: 600,
    notes: [
      "300 grapheme clusters AND 3000 UTF-8 bytes — both must be satisfied; emoji-heavy captions can hit the byte limit first even under 300 graphemes.",
      "Up to 4 images, or exactly 1 video — never both.",
    ],
  },
  discord: {
    confidence: "approximate",
    textUnit: "chars",
    textLimit: 2000,
    notes: [
      "2000-character message limit for a normal bot (long-standing, stable figure, but not re-confirmed against a directly-rendered doc page this pass).",
      "Embeds have a separate, confirmed 6000-character aggregate across all embed fields.",
    ],
  },
};

export function getContentRules(platform: PlatformId): PlatformContentRules {
  return CONTENT_RULES[platform];
}

/** Grapheme-cluster count (what a human would call "characters") — needed for Bluesky. */
function graphemeCount(text: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...seg.segment(text)].length;
  }
  return [...text].length; // fallback: code-point count, close enough without Intl.Segmenter
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// Rough approximation of X's weighted character counting: most chars weigh 1,
// wide/CJK/emoji-ish codepoints weigh 2. Not the exact twitter-text algorithm,
// but close enough for a compose-time estimate.
function xWeightedLength(text: string): number {
  let total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const isWide =
      cp >= 0x1100 &&
      ((cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
        (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK etc.
        (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
        (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
        (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
        cp >= 0x1f300); // emoji & symbol blocks (approximate floor)
    total += isWide ? 2 : 1;
  }
  return total;
}

export interface TextCountResult {
  count: number;
  limit?: number;
  unit: TextCountUnit;
  overBy: number;
}

/**
 * Counts `text` (caption + hashtags + link, already combined by the caller)
 * the way `platform` counts it, substituting `linkFixedCost` for `linkUrl`
 * if the platform shortens links.
 */
export function countComposeText(
  platform: PlatformId,
  parts: { caption: string; hashtags?: string; linkUrl?: string },
): TextCountResult {
  const rules = getContentRules(platform);
  const segments: string[] = [];
  if (parts.caption) segments.push(parts.caption);
  if (parts.hashtags) segments.push(parts.hashtags);

  let count: number;
  if (platform === "x") {
    count = xWeightedLength(segments.join(" "));
  } else if (rules.textUnit === "bytes") {
    count = utf8ByteLength(segments.join(" "));
  } else if (rules.textUnit === "graphemes") {
    count = graphemeCount(segments.join(" "));
  } else {
    count = segments.join(" ").length;
  }

  if (parts.linkUrl) {
    if (rules.linkFixedCost !== undefined) {
      count += rules.linkFixedCost + 1; // +1 for the joining space
    } else if (rules.textUnit === "bytes") {
      count += utf8ByteLength(parts.linkUrl) + 1;
    } else if (rules.textUnit === "graphemes") {
      count += graphemeCount(parts.linkUrl) + 1;
    } else {
      count += parts.linkUrl.length + 1;
    }
  }

  const limit = rules.textLimit;
  return { count, limit, unit: rules.textUnit, overBy: limit ? Math.max(0, count - limit) : 0 };
}

export interface MediaValidation {
  ok: boolean;
  issues: string[];
}

export function validateComposeMedia(
  platform: PlatformId,
  media: Array<{ kind: "image" | "video" }>,
): MediaValidation {
  const rules = getContentRules(platform);
  const issues: string[] = [];
  const images = media.filter((m) => m.kind === "image").length;
  const videos = media.filter((m) => m.kind === "video").length;

  if (rules.requiresMedia && media.length === 0) {
    issues.push(`${platform} requires at least one image or video — text-only posts aren't supported.`);
  }
  if (rules.maxImages !== undefined && images > rules.maxImages) {
    issues.push(`Too many images (${images}) — ${platform} allows at most ${rules.maxImages}.`);
  }
  if (rules.maxVideos !== undefined && videos > rules.maxVideos) {
    issues.push(`Too many videos (${videos}) — ${platform} allows at most ${rules.maxVideos}.`);
  }
  if (images > 0 && videos > 0 && rules.mixedMediaAllowed === false) {
    issues.push(`${platform} doesn't allow mixing images and video in one post.`);
  }
  return { ok: issues.length === 0, issues };
}
