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
  /** Ordered step-by-step instructions for creating the developer app / getting credentials. */
  guide?: string[];
  required: boolean;
  platforms?: string[]; // platforms that depend on this
}

export async function GET() {
  try { await requireSession(); } catch (e) {
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
  const baseUrl = process.env.SOCMED_BASE_URL ?? "http://localhost:3000";
  const callback = (platform: string) => `${baseUrl}/api/accounts/oauth/callback/${platform}`;

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
      description: "X_CLIENT_ID and X_CLIENT_SECRET for the X API v2 OAuth 2.0 (PKCE) flow.",
      done: has("X_CLIENT_ID") && has("X_CLIENT_SECRET"),
      hint: "https://developer.x.com/en/portal",
      guide: [
        "Sign up for a developer account at developer.x.com (approval can take anywhere from minutes to a few days).",
        "Create a Project, then create an App inside that Project.",
        "Open the app's 'User authentication settings' → Edit. Enable OAuth 2.0, set App permissions to 'Read and write', and Type of App to 'Web App, Automated App or Bot'.",
        `Set the Callback URI / Redirect URL to: ${callback("x")}`,
        "Set a Website URL (any valid URL for your app/company works).",
        "Save, then go to 'Keys and tokens' and copy the OAuth 2.0 Client ID and Client Secret into X_CLIENT_ID / X_CLIENT_SECRET.",
        "Posting requires a paid API access tier — the Free tier is read-only. Check current pricing at developer.x.com before relying on this.",
      ],
      required: false,
      platforms: ["x"],
    },
    {
      id: "linkedin_env",
      label: "LinkedIn app credentials",
      description: "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET from a LinkedIn Developer app.",
      done: has("LINKEDIN_CLIENT_ID") && has("LINKEDIN_CLIENT_SECRET"),
      hint: "https://www.linkedin.com/developers/apps",
      guide: [
        "Go to linkedin.com/developers/apps → Create app. You need an associated LinkedIn Company Page — create one first (even a minimal one) if you don't have one, LinkedIn requires it to create an app.",
        "On the app's Products tab, request 'Sign In with LinkedIn using OpenID Connect' — this is usually auto-approved and grants the openid/profile/email scopes.",
        "Also request whichever product currently grants posting on a member's behalf (the w_member_social scope) — LinkedIn has renamed/rebundled this product before, so check the exact current name in your Products tab (historically 'Share on LinkedIn').",
        `On the Auth tab, add this exact Redirect URL: ${callback("linkedin")}`,
        "Copy the Client ID and Client Secret from the Auth tab into LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET.",
      ],
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
      guide: [
        "Go to developers.facebook.com/apps → Create App, type 'Business', and connect (or create) a Business Portfolio.",
        "Add only the products you actually need: 'Instagram' for Instagram Login (needs an Instagram Professional/Business account — no linked Facebook Page required for this flow), 'Facebook Login for Business' + the Pages API for Facebook Page posting, and/or the Threads API product.",
        `Set the Instagram redirect URI to: ${callback("instagram")}`,
        `Set the Facebook redirect URI to: ${callback("facebook")}`,
        `Set the Threads redirect URI to: ${callback("threads")}`,
        "Copy the App ID / App Secret from Settings → Basic into INSTAGRAM_APP_ID/SECRET (and FACEBOOK_APP_ID/SECRET, THREADS_APP_ID/SECRET — they can be the same values from one app, or separate apps).",
        "While the app is in Development mode, only accounts you've added as Testers/Admins under Roles can connect — submit for App Review to let other users connect.",
      ],
      required: false,
      platforms: ["instagram", "facebook", "threads"],
    },
    {
      id: "youtube_env",
      label: "YouTube / Google OAuth credentials",
      description: "YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET from a Google Cloud OAuth client.",
      done: has("YOUTUBE_CLIENT_ID") && has("YOUTUBE_CLIENT_SECRET"),
      hint: "https://console.cloud.google.com/apis/credentials",
      guide: [
        "Go to console.cloud.google.com → create or select a project.",
        "APIs & Services → Library → search for and enable 'YouTube Data API v3'.",
        "APIs & Services → OAuth consent screen → configure it (choose External unless you're on Google Workspace; add your own Google account under Test users while the app is unverified).",
        "APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type 'Web application'.",
        `Add this to Authorized redirect URIs: ${callback("youtube")}`,
        "Copy the Client ID / Client Secret into YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET.",
        "While the consent screen is in 'Testing' mode, only the test users you explicitly added can connect an account — submit for verification to open it up.",
      ],
      required: false,
      platforms: ["youtube"],
    },
    {
      id: "pinterest_env",
      label: "Pinterest app credentials",
      description: "PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET. Requires Pinterest app review for production.",
      done: has("PINTEREST_CLIENT_ID") && has("PINTEREST_CLIENT_SECRET"),
      hint: "https://developers.pinterest.com/apps/",
      guide: [
        "Go to developers.pinterest.com/apps → Create app.",
        `Set the Redirect URI to: ${callback("pinterest")}`,
        "Request scopes: boards:read, boards:write, pins:read, pins:write, user_accounts:read.",
        "Copy the App ID and App secret into PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET.",
        "New apps start with Trial access, which is fine for connecting your own account(s). Apply for Standard/Advanced access if other people need to connect their Pinterest accounts.",
      ],
      required: false,
      platforms: ["pinterest"],
    },
    {
      id: "reddit_env",
      label: "Reddit app credentials",
      description: "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET from a 'web app' type Reddit app.",
      done: has("REDDIT_CLIENT_ID") && has("REDDIT_CLIENT_SECRET"),
      hint: "https://www.reddit.com/prefs/apps",
      guide: [
        "Go to reddit.com/prefs/apps → click 'create another app...' at the bottom.",
        "Choose type 'web app' — NOT 'script'. Script apps are single-account and can't use the redirect-based authorization flow this app needs (only web app and installed app support a redirect_uri).",
        `Set the redirect uri field to: ${callback("reddit")}`,
        "Copy the client ID (the string under the app's name, not labeled) and the secret into REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET.",
        "Reddit enforces a mandatory, descriptive User-Agent on every request (already handled by this app) and has separate commercial API terms/pricing for high-volume use — check Reddit's Data API Terms if this will see real traffic.",
      ],
      required: false,
      platforms: ["reddit"],
    },
    {
      id: "tiktok_env",
      label: "TikTok app credentials",
      description: "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET from a TikTok Developer app with Login Kit + Content Posting API.",
      done: has("TIKTOK_CLIENT_KEY") && has("TIKTOK_CLIENT_SECRET"),
      hint: "https://developers.tiktok.com/apps/",
      guide: [
        "Go to developers.tiktok.com/apps → Create an app (Manage apps → Connect an app).",
        "Add the 'Login Kit' product and the 'Content Posting API' product.",
        `Set the Redirect URI to: ${callback("tiktok")}`,
        "Copy the Client Key and Client Secret into TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET.",
        "Until your app passes TikTok's audit, videos publish as private drafts to the creator's TikTok inbox (not directly to their public profile) — that's a TikTok platform restriction on unaudited apps, not a bug here.",
      ],
      required: false,
      platforms: ["tiktok"],
    },
    {
      id: "discord_env",
      label: "Discord bot token (optional)",
      description: "One bot can post to many guilds/channels. Add the token per-account on the Accounts page, not here.",
      done: has("DISCORD_BOT_TOKEN"),
      hint: "https://discord.com/developers/applications",
      guide: [
        "Go to discord.com/developers/applications → New Application.",
        "Bot tab → Reset Token → copy it immediately (Discord won't show it again).",
        "No Privileged Gateway Intents are needed just to post messages.",
        "OAuth2 → URL Generator → check scope 'bot' → check permissions 'Send Messages' (and 'Attach Files' if you'll post media) → open the generated URL to invite the bot into your server.",
        "Enable Developer Mode in Discord's own settings (Advanced), then right-click each channel you want to post to → Copy Channel ID.",
        "On the Accounts page, add Discord with the bot token and the channel ID(s) — no env var is required for this one.",
      ],
      required: false,
      platforms: ["discord"],
    },
    {
      id: "bluesky_env",
      label: "Bluesky PDS (optional)",
      description: "BLUESKY_PDS_URL — defaults to https://bsky.social. App passwords are added per-account on the Accounts page.",
      done: has("BLUESKY_PDS_URL"),
      guide: [
        "No developer app is needed — Bluesky uses per-account app passwords, not OAuth client credentials.",
        "In the Bluesky app: Settings → App Passwords → Add App Password → copy it (shown once).",
        "On the Accounts page, add Bluesky with your handle (e.g. you.bsky.social) and the app password.",
        "Only set BLUESKY_PDS_URL here if you're self-hosting a Personal Data Server other than bsky.social.",
      ],
      required: false,
      platforms: ["bluesky"],
    },
    {
      id: "mastodon_note",
      label: "Mastodon (no setup needed here)",
      description: "Mastodon is federated — this app registers a client app dynamically with whichever instance a user connects to. Nothing to configure on this page.",
      done: true,
      guide: [
        "On the Accounts page, enter the instance URL (e.g. https://mastodon.social) and click Connect — the app registers itself with that instance automatically the first time.",
      ],
      required: false,
      platforms: ["mastodon"],
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
