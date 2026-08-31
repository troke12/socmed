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

export const runtime = "nodejs";

const VALID_PLATFORMS = new Set<Platform>([
  "tiktok", "linkedin", "instagram", "x",
  "facebook", "threads", "youtube", "pinterest", "reddit",
  "mastodon", "bluesky", "discord",
]);

export async function GET(req: NextRequest, ctx: { params: { platform: string } }) {
  const platform = ctx.params.platform;
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
  let parsed: { platform: string; handle: string; displayName?: string; instanceUrl?: string; state: string; label?: string };
  try {
    parsed = JSON.parse(stateCookie);
  } catch {
    return NextResponse.json({ error: "invalid oauth_state" }, { status: 400 });
  }
  if (parsed.state !== state) return NextResponse.json({ error: "state mismatch" }, { status: 400 });
  if (parsed.platform !== platform) return NextResponse.json({ error: "platform mismatch" }, { status: 400 });

  await runMigrations();

  // For platforms without OAuth (discord, bluesky), the start route should not have been used.
  let creds;
  try {
    const baseUrl = process.env.SOCMED_BASE_URL ?? "http://localhost:3000";
    const redirectUri = `${baseUrl}/api/accounts/oauth/callback/${platform}`;
    if (platform === "mastodon") {
      if (!parsed.instanceUrl) {
        return NextResponse.redirect(new URL("/accounts?error=mastodon_instance_missing", req.url));
      }
      creds = await mastodonCompleteOAuth(code, parsed.instanceUrl);
      // Persist the instance URL
      parsed.instanceUrl = parsed.instanceUrl;
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

  const label = parsed.label ?? parsed.handle;
  const dup = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.platform, platform as Platform), eq(accounts.label, label)))
    .get();
  if (dup) {
    return NextResponse.redirect(new URL("/accounts?error=duplicate", req.url));
  }

  const now = Math.floor(Date.now() / 1000);
  const temp = db
    .insert(accounts)
    .values({
      platform: platform as Platform,
      label,
      handle: parsed.handle,
      displayName: parsed.displayName ?? null,
      instanceUrl: parsed.instanceUrl ?? null,
      encryptedCreds: Buffer.alloc(0),
      credsIv: Buffer.alloc(0),
      credsTag: Buffer.alloc(0),
      webhookSecret: randomBytes(32).toString("base64url"),
      scopes: JSON.stringify(creds.raw?.scope ? String(creds.raw.scope).split(/[,\s]+/) : []),
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

  const res = NextResponse.redirect(new URL("/accounts?ok=1", req.url));
  res.cookies.set("oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
