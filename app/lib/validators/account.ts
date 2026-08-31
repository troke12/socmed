import { z } from "zod";

export const PlatformEnum = z.enum([
  "tiktok",
  "linkedin",
  "instagram",
  "x",
  "facebook",
  "threads",
  "youtube",
  "pinterest",
  "reddit",
  "mastodon",
  "bluesky",
  "discord",
]);

export const CreateAccountBody = z.object({
  platform: PlatformEnum,
  // User-supplied friendly name (unique per platform). Auto-generated from
  // platform name + sequence if omitted.
  label: z.string().min(1).max(64).optional(),
  // Handle is only required where the platform needs it (Bluesky identifier,
  // Mastodon/@handle). For OAuth platforms it's optional — the account is
  // identified by label.
  handle: z.string().max(128).optional().default(""),
  displayName: z.string().max(128).optional(),
  creds: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().optional(),
    expiresAt: z.number().int().positive().optional(),
    raw: z.record(z.string(), z.unknown()).optional(),
  }),
  scopes: z.array(z.string()).default([]),
  tokenExpiresAt: z.number().int().positive().optional(),
  // For Mastodon/Bluesky/Discord — instance/server/PDS URL or guild ID
  // (Discord stores guild ID here; not a real URL)
  instanceUrl: z.string().min(1).max(512).optional(),
});

export type CreateAccountInput = z.infer<typeof CreateAccountBody>;
