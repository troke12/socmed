import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { accounts, type Platform } from "@db/schema";
import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { encryptJson, pack } from "@platforms/crypto";
import { mastodonCompleteOAuth } from "@platforms/mastodon/client";
import { assertSafeOutboundUrl } from "@/lib/security/url";

export const runtime = "nodejs";

const VALID_PLATFORMS = new Set<Platform>([
  "tiktok", "linkedin", "instagram", "x",
  "facebook", "threads", "youtube", "pinterest", "reddit",
  "mastodon", "bluesky", "discord",
]);

function safeRedirect(raw: string | undefined): string {
  if (!raw) return "/accounts";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/accounts";
  if (raw.includes("\\") || raw.includes("..")) return "/accounts";
  return raw;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ platform: string }> },
) {
  const { platform } = await ctx.params;
  if (!VALID_PLATFORMS.has(platform as Platform)) {
    return NextResponse.json({ error: "invalid platform" }, { status: 400 });
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/accounts?error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code || !state) {
    return NextResponse.json({ error: "missing code or state" }, { status: 400 });
  }
  const stateCookie = req.cookies.get("oauth_state")?.value;
  if (!stateCookie) return NextResponse.json({ error: "no oauth_state cookie" }, { status: 400 });
  let parsed: {
    platform: string;
    handle: string;
    displayName?: string;
    instanceUrl?: string;
    state: string;
    label?: string;
    redirect?: string;
  };
  try {
    parsed = JSON.parse(stateCookie);
  } catch {
    return NextResponse.json({ error: "invalid oauth_state" }, { status: 400 });
  }
  if (parsed.state !== state) return NextResponse.json({ error: "state mismatch" }, { status: 400 });
  if (parsed.platform !== platform) return NextResponse.json({ error: "platform mismatch" }, { status: 400 });

  await runMigrations();

  let creds;
  try {
    const baseUrl = process.env.SOCMED_BASE_URL ?? "http://localhost:3000";
    const redirectUri = `${baseUrl}/api/accounts/oauth/callback/${platform}`;
    if (platform === "mastodon") {
      if (!parsed.instanceUrl) {
        return NextResponse.redirect(new URL("/accounts?error=mastodon_instance_missing", req.url));
      }
      // SSRF guard on the stored instance URL before exchanging tokens.
      try {
        assertSafeOutboundUrl(parsed.instanceUrl, "Mastodon instance URL");
      } catch (e) {
        return NextResponse.redirect(
          new URL(`/accounts?error=${encodeURIComponent((e as Error).message)}`, req.url),
        );
      }
      creds = await mastodonCompleteOAuth(code, parsed.instanceUrl);
    } else {
      const adapter = getAdapter(platform as Parameters<typeof getAdapter>[0]);
      if (!adapter.completeOAuth) {
        return NextResponse.json({ error: `${platform} does not support OAuth` }, { status: 400 });
      }
      creds = await adapter.completeOAuth(code, redirectUri, state);
    }
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/accounts?error=${encodeURIComponent((e as Error).message)}`, req.url),
    );
  }

  const label = parsed.label ?? (parsed.handle || (await nextLabel(platform as Platform)));
  const handle = parsed.handle ?? "";
  const dup = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.platform, platform as Platform), eq(accounts.label, label)))
    .get();
  if (dup) {
    return NextResponse.redirect(new URL("/accounts?error=duplicate", req.url));
  }

  const now = Math.floor(Date.now() / 1000);
  const scopeRaw = (creds.raw as { scope?: unknown } | undefined)?.scope;
  const scopes = typeof scopeRaw === "string" ? scopeRaw.split(/[,\s]+/) : [];
  const temp = db
    .insert(accounts)
    .values({
      platform: platform as Platform,
      label,
      handle,
      displayName: parsed.displayName ?? null,
      instanceUrl: parsed.instanceUrl ?? null,
      encryptedCreds: Buffer.alloc(0),
      credsIv: Buffer.alloc(0),
      credsTag: Buffer.alloc(0),
      webhookSecret: randomBytes(32).toString("base64url"),
      scopes: JSON.stringify(scopes),
      tokenExpiresAt: creds.expiresAt ?? null,
      createdAt: now,
      status: "active",
    })
    .returning({ id: accounts.id })
    .get();
  if (!temp) {
    return NextResponse.redirect(new URL("/accounts?error=insert_failed", req.url));
  }
  const ct = encryptJson(temp.id, creds);
  const packed = pack(ct);
  db.update(accounts)
    .set({ encryptedCreds: packed.encryptedCreds, credsIv: packed.credsIv, credsTag: packed.credsTag })
    .where(eq(accounts.id, temp.id))
    .run();

  const res = NextResponse.redirect(new URL(safeRedirect(parsed.redirect), req.url));
  // Consume the one-time state cookie.
  res.cookies.set("oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}

// Auto-label: "X 1", "X 2", ... per platform when the user skipped naming.
async function nextLabel(platform: Platform): Promise<string> {
  const row = db
    .select({ n: accounts.id })
    .from(accounts)
    .where(eq(accounts.platform, platform))
    .all();
  const display = platform.charAt(0).toUpperCase() + platform.slice(1);
  return `${display} ${row.length + 1}`;
}
