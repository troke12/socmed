import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require";
import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { mastodonBeginOAuth } from "@platforms/mastodon/client";

export const runtime = "nodejs";

const Body = z.object({
  platform: z.enum([
    "tiktok", "linkedin", "instagram", "x",
    "facebook", "threads", "youtube", "pinterest", "reddit",
    "mastodon", "bluesky", "discord",
  ]),
  // Optional for OAuth platforms — label is auto-generated. Mastodon uses
  // instanceUrl instead. Bluesky/Discord don't use this route.
  handle: z.string().max(64).optional(),
  label: z.string().max(64).optional(),
  displayName: z.string().max(128).optional(),
  // For Mastodon: required (instance URL).
  instanceUrl: z.string().url().optional(),
});

export async function POST(req: Request) {
  try { requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const { platform, handle, label, displayName, instanceUrl } = parsed.data;
  try {
    const baseUrl = process.env.SOCMED_BASE_URL ?? "http://localhost:3000";
    const redirectUri = `${baseUrl}/api/accounts/oauth/callback/${platform}`;

    let authUrl: string;
    let state: string;

    if (platform === "mastodon") {
      if (!instanceUrl) {
        return NextResponse.json(
          { error: "instanceUrl is required for Mastodon (e.g. https://mastodon.social)" },
          { status: 400 },
        );
      }
      const oauth = await mastodonBeginOAuth(instanceUrl);
      authUrl = oauth.authUrl;
      state = oauth.state;
    } else {
      const adapter = getAdapter(platform);
      if (!adapter.beginOAuth) {
        return NextResponse.json(
          { error: `${platform} does not support OAuth — add a token instead` },
          { status: 400 },
        );
      }
      const oauth = await adapter.beginOAuth(redirectUri);
      authUrl = oauth.authUrl;
      state = oauth.state;
    }

    const res = NextResponse.json({ authUrl });
    res.cookies.set(
      "oauth_state",
      JSON.stringify({ platform, handle: handle ?? "", label, displayName, instanceUrl, state }),
      { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 },
    );
    return res;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
