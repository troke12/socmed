// Shared platform metadata for the UI. Single source of truth for
// labels, brand colors, and icons (Font Awesome brands) used across pages.

import {
  faXTwitter,
  faLinkedinIn,
  faInstagram,
  faFacebookF,
  faThreads,
  faTiktok,
  faYoutube,
  faPinterestP,
  faRedditAlien,
  faMastodon,
  faBluesky,
  faDiscord,
} from "@fortawesome/free-brands-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

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
  /** Font Awesome brand icon (render via <FontAwesomeIcon icon={...} />) */
  icon: IconDefinition;
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
    icon: faXTwitter,
    color: "#000000",
    bg: "bg-slate-950",
    text: "text-white",
    auth: "oauth",
    description: "Tweets, threads, media. Requires X API Basic tier.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    icon: faLinkedinIn,
    color: "#0A66C2",
    bg: "bg-[#0A66C2]",
    text: "text-white",
    auth: "oauth",
    description: "Professional posts, images, UGC content.",
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: faInstagram,
    color: "#E1306C",
    bg: "bg-gradient-to-tr from-[#F58529] via-[#E1306C] to-[#833AB4]",
    text: "text-white",
    auth: "oauth",
    description: "Feed posts, reels, carousels. Business account required.",
  },
  {
    id: "facebook",
    name: "Facebook",
    icon: faFacebookF,
    color: "#1877F2",
    bg: "bg-[#1877F2]",
    text: "text-white",
    auth: "oauth",
    description: "Page posts, photos, links. One account per page.",
  },
  {
    id: "threads",
    name: "Threads",
    icon: faThreads,
    color: "#000000",
    bg: "bg-slate-950",
    text: "text-white",
    auth: "oauth",
    description: "Short-form text posts via Meta Graph.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    icon: faTiktok,
    color: "#000000",
    bg: "bg-slate-950",
    text: "text-white",
    auth: "oauth",
    description: "Video-first content. App review required.",
  },
  {
    id: "youtube",
    name: "YouTube",
    icon: faYoutube,
    color: "#FF0000",
    bg: "bg-[#FF0000]",
    text: "text-white",
    auth: "oauth",
    description: "Video uploads, titles, descriptions, tags.",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    icon: faPinterestP,
    color: "#E60023",
    bg: "bg-[#E60023]",
    text: "text-white",
    auth: "oauth",
    description: "Pins, boards, image links.",
  },
  {
    id: "reddit",
    name: "Reddit",
    icon: faRedditAlien,
    color: "#FF4500",
    bg: "bg-[#FF4500]",
    text: "text-white",
    auth: "oauth",
    description: "Self/link posts to subreddits.",
  },
  {
    id: "mastodon",
    name: "Mastodon",
    icon: faMastodon,
    color: "#6364FF",
    bg: "bg-[#6364FF]",
    text: "text-white",
    auth: "oauth",
    description: "Federated microblogging. Instance-based.",
  },
  {
    id: "bluesky",
    name: "Bluesky",
    icon: faBluesky,
    color: "#0A7AFF",
    bg: "bg-[#0A7AFF]",
    text: "text-white",
    auth: "token",
    description: "AT Protocol. App passwords per account.",
  },
  {
    id: "discord",
    name: "Discord",
    icon: faDiscord,
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
