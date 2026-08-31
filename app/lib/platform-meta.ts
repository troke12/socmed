// Shared platform metadata for the UI. Single source of truth for
// labels, brand colors, and lucide icons used across pages.

export type PlatformId =
  | "tiktok"
  | "linkedin"
  | "instagram"
  | "x"
  | "facebook"
  | "threads"
  | "youtube"
  | "pinterest"
  | "reddit"
  | "mastodon"
  | "bluesky"
  | "discord";

export interface PlatformMeta {
  id: PlatformId;
  name: string;
  short: string; // brand-ish initial for the avatar
  color: string; // brand color (hex)
  bg: string; // tailwind bg class (light)
  text: string; // tailwind text class
  auth: "oauth" | "token" | "both";
  description: string;
}

export const PLATFORMS: PlatformMeta[] = [
  {
    id: "x",
    name: "X (Twitter)",
    short: "𝕏",
    color: "#000000",
    bg: "bg-slate-950",
    text: "text-white",
    auth: "oauth",
    description: "Tweets, threads, media. Requires X API Basic tier.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    short: "in",
    color: "#0A66C2",
    bg: "bg-[#0A66C2]",
    text: "text-white",
    auth: "oauth",
    description: "Professional posts, images, UGC content.",
  },
  {
    id: "instagram",
    name: "Instagram",
    short: "IG",
    color: "#E1306C",
    bg: "bg-gradient-to-tr from-[#F58529] via-[#E1306C] to-[#833AB4]",
    text: "text-white",
    auth: "oauth",
    description: "Feed posts, reels, carousels. Business account required.",
  },
  {
    id: "facebook",
    name: "Facebook",
    short: "f",
    color: "#1877F2",
    bg: "bg-[#1877F2]",
    text: "text-white",
    auth: "oauth",
    description: "Page posts, photos, links. One account per page.",
  },
  {
    id: "threads",
    name: "Threads",
    short: "@",
    color: "#000000",
    bg: "bg-slate-950",
    text: "text-white",
    auth: "oauth",
    description: "Short-form text posts via Meta Graph.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    short: "TT",
    color: "#000000",
    bg: "bg-slate-950",
    text: "text-white",
    auth: "oauth",
    description: "Video-first content. App review required.",
  },
  {
    id: "youtube",
    name: "YouTube",
    short: "▶",
    color: "#FF0000",
    bg: "bg-[#FF0000]",
    text: "text-white",
    auth: "oauth",
    description: "Video uploads, titles, descriptions, tags.",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    short: "P",
    color: "#E60023",
    bg: "bg-[#E60023]",
    text: "text-white",
    auth: "oauth",
    description: "Pins, boards, image links.",
  },
  {
    id: "reddit",
    name: "Reddit",
    short: "r",
    color: "#FF4500",
    bg: "bg-[#FF4500]",
    text: "text-white",
    auth: "oauth",
    description: "Self/link posts to subreddits.",
  },
  {
    id: "mastodon",
    name: "Mastodon",
    short: "M",
    color: "#6364FF",
    bg: "bg-[#6364FF]",
    text: "text-white",
    auth: "oauth",
    description: "Federated microblogging. Instance-based.",
  },
  {
    id: "bluesky",
    name: "Bluesky",
    short: "☁",
    color: "#0A7AFF",
    bg: "bg-[#0A7AFF]",
    text: "text-white",
    auth: "token",
    description: "AT Protocol. App passwords per account.",
  },
  {
    id: "discord",
    name: "Discord",
    short: "D",
    color: "#5865F2",
    bg: "bg-[#5865F2]",
    text: "text-white",
    auth: "token",
    description: "Bot posts to channels. Bot token + guild/channel IDs.",
  },
];

export const PLATFORM_MAP: Record<PlatformId, PlatformMeta> = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p])
) as Record<PlatformId, PlatformMeta>;

export function getPlatform(id: string): PlatformMeta | undefined {
  return PLATFORM_MAP[id as PlatformId];
}
