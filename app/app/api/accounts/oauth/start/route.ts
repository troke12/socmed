import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { mastodonBeginOAuth } from "@platforms/mastodon/client";
import { assertSafeOutboundUrl } from "@/lib/security/url";

export const runtime = "nodejs";

const Body = z.object({
  platform: z.enum([
    "tiktok", "linkedin", "instagram", "x",
    "facebook", "threads", "youtube", "pinterest", "reddit",
    "mastodon", "bluesky", "discord",
  ]),
  handle: z.string().max(64).optional(),
  label: z.string().max(64).optional(),
  displayName: z.string().max(128).optional(),
  instanceUrl: z.string().url().optional(),
  redirect: z.string().max(512).optional(),
});

// Only allow redirects back into the app itself (blocks open redirects).
function safeRedirect(raw: string | undefined): string {
  if (!raw) return "/accounts";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/accounts";
  if (raw.includes("\\") || raw.includes("..")) return "/accounts";
  return raw;
}

export async function POST(req: NextRequest) {
  try { await requireRole("admin"); } catch (e) {
    return authErrorResponse(e);
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
      // SSRF guard: only public https hosts, no loopback/private ranges.
      try {
        assertSafeOutboundUrl(instanceUrl, "Mastodon instance URL");
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
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
    const secure = process.env.NODE_ENV === "production" || process.env.SOCMED_COOKIE_SECURE === "true";
    res.cookies.set(
      "oauth_state",
      JSON.stringify({
        platform,
        handle: handle ?? "",
        label,
        displayName,
        instanceUrl,
        state,
        redirect: safeRedirect(parsed.data.redirect),
      }),
      { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 600 },
    );
    return res;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
