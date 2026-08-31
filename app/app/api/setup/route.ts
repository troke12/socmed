import { NextResponse } from "next/server";
import { runMigrations } from "@db/migrate";
import { requireSession } from "@/lib/auth/require";
import { sqlite } from "@db/client";

export const runtime = "nodejs";

interface Check {
  id: string;
  label: string;
  description: string;
  done: boolean;
  hint?: string;
  required: boolean;
  platforms?: string[]; // platforms that depend on this
}

export async function GET() {
  try { requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  await runMigrations();

  // DB reachable
  let dbOk = true;
  try {
    sqlite.prepare("SELECT 1").get();
  } catch {
    dbOk = false;
  }

  const has = (k: string) => Boolean(process.env[k] && process.env[k]!.length > 0);

  // Check if a user exists (i.e. seed user was created or not)
  const userCountRow = sqlite.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number };
  const hasUsers = userCountRow.n > 0;

  // Count accounts per platform
  const accountRows = sqlite
    .prepare("SELECT platform, COUNT(*) as n FROM accounts GROUP BY platform")
    .all() as Array<{ platform: string; n: number }>;
  const accountsByPlatform: Record<string, number> = {};
  for (const r of accountRows) accountsByPlatform[r.platform] = r.n;

  const checks: Check[] = [
    {
      id: "db",
      label: "Database reachable",
      description: "SQLite file at SOCMED_DB_PATH is readable and migrations applied.",
      done: dbOk,
      required: true,
    },
    {
      id: "admin_user",
      label: "Admin user created",
      description: "First login automatically creates the admin user from SOCMED_ADMIN_USERNAME/PASSWORD.",
      done: hasUsers,
      required: true,
    },
    {
      id: "master_key",
      label: "Encryption master key set",
      description: "SOCMED_MASTER_KEY is set (32 random bytes, base64). Used to encrypt account credentials at rest.",
      done: has("SOCMED_MASTER_KEY"),
      required: true,
    },
    {
      id: "cookie_secret",
      label: "Session cookie secret set",
      description: "SOCMED_COOKIE_SECRET is set (>=32 chars). Used to sign session cookies.",
      done: has("SOCMED_COOKIE_SECRET"),
      required: true,
    },
    {
      id: "base_url",
      label: "Public base URL set",
      description: "SOCMED_BASE_URL is the public URL where this app is reachable. Used for OAuth callbacks and webhook URLs.",
      done: has("SOCMED_BASE_URL"),
      required: true,
    },
    {
      id: "x_env",
      label: "X (Twitter) app credentials",
      description: "X_CLIENT_ID and X_CLIENT_SECRET for the X API v2 OAuth flow. Sign up at developer.twitter.com.",
      done: has("X_CLIENT_ID") && has("X_CLIENT_SECRET"),
      hint: "https://developer.twitter.com/en/portal",
      required: false,
      platforms: ["x"],
    },
    {
      id: "linkedin_env",
      label: "LinkedIn app credentials",
      description: "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET from a LinkedIn Developer app.",
      done: has("LINKEDIN_CLIENT_ID") && has("LINKEDIN_CLIENT_SECRET"),
      hint: "https://www.linkedin.com/developers/",
      required: false,
      platforms: ["linkedin"],
    },
    {
      id: "instagram_env",
      label: "Meta (Instagram/Facebook/Threads) app credentials",
      description: "Set INSTAGRAM_APP_ID/SECRET, FACEBOOK_APP_ID/SECRET, and/or THREADS_APP_ID/SECRET. They can all point to the same Meta app.",
      done:
        (has("INSTAGRAM_APP_ID") && has("INSTAGRAM_APP_SECRET")) ||
        (has("FACEBOOK_APP_ID") && has("FACEBOOK_APP_SECRET")) ||
        (has("THREADS_APP_ID") && has("THREADS_APP_SECRET")),
      hint: "https://developers.facebook.com/apps/",
      required: false,
      platforms: ["instagram", "facebook", "threads"],
    },
    {
      id: "youtube_env",
      label: "YouTube / Google OAuth credentials",
      description: "YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET from a Google Cloud OAuth client.",
      done: has("YOUTUBE_CLIENT_ID") && has("YOUTUBE_CLIENT_SECRET"),
      hint: "https://console.cloud.google.com/apis/credentials",
      required: false,
      platforms: ["youtube"],
    },
    {
      id: "pinterest_env",
      label: "Pinterest app credentials",
      description: "PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET. Requires Pinterest app review for production.",
      done: has("PINTEREST_CLIENT_ID") && has("PINTEREST_CLIENT_SECRET"),
      hint: "https://developers.pinterest.com/",
      required: false,
      platforms: ["pinterest"],
    },
    {
      id: "reddit_env",
      label: "Reddit app credentials",
      description: "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET from a 'script' type Reddit app.",
      done: has("REDDIT_CLIENT_ID") && has("REDDIT_CLIENT_SECRET"),
      hint: "https://www.reddit.com/prefs/apps",
      required: false,
      platforms: ["reddit"],
    },
    {
      id: "discord_env",
      label: "Discord bot token (optional)",
      description: "DISCORD_BOT_TOKEN — one bot can post to many guilds/channels. Add the token per-account on the Accounts page, not here.",
      done: has("DISCORD_BOT_TOKEN"),
      required: false,
      platforms: ["discord"],
    },
    {
      id: "bluesky_env",
      label: "Bluesky PDS (optional)",
      description: "BLUESKY_PDS_URL — defaults to https://bsky.social. App passwords are added per-account on the Accounts page.",
      done: has("BLUESKY_PDS_URL"),
      required: false,
      platforms: ["bluesky"],
    },
  ];

  // Summary
  const totalRequired = checks.filter((c) => c.required).length;
  const doneRequired = checks.filter((c) => c.required && c.done).length;
  const totalOptional = checks.filter((c) => !c.required).length;
  const doneOptional = checks.filter((c) => !c.required && c.done).length;

  return NextResponse.json({
    checks,
    summary: {
      required: { done: doneRequired, total: totalRequired },
      optional: { done: doneOptional, total: totalOptional },
      ready: doneRequired === totalRequired,
    },
    accountsByPlatform,
  });
}
