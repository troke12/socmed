// Webhook ingress for all platforms. Uses ?platform=x in the query string.
//
// Configure each platform's webhook URL in their dev console as:
//   https://your.domain/api/webhooks?platform=x

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@db/client";
import { accounts } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";
import { verifyHubSignature, verifyHmacHeader, resolveHubChallenge } from "@/lib/security/webhook";

export const runtime = "nodejs";

const VALID = new Set([
  "tiktok", "linkedin", "instagram", "x",
  "facebook", "threads", "youtube", "pinterest", "reddit",
  "mastodon", "bluesky", "discord",
]);

function isValid(s: string): boolean {
  return VALID.has(s);
}

function resolvePlatform(req: NextRequest): string | null {
  const q = req.nextUrl.searchParams.get("platform");
  if (q && isValid(q)) return q;
  return null;
}

function collectHeaders(req: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  return headers;
}

// Per-account secret used for HMAC verification. Looks up the account by
// platform (falling back to the platform's env-level verify token).
function lookupSecret(platform: string): string | undefined {
  // Prefer a per-account webhook secret — the account rows store one per
  // account (webhookSecret column), so pick the most recently created one.
  const row = db
    .select({ webhookSecret: accounts.webhookSecret })
    .from(accounts)
    .where(eq(accounts.platform, platform as never))
    .orderBy(desc(accounts.createdAt))
    .get();
  if (row?.webhookSecret) return row.webhookSecret;
  return process.env[`${platform.toUpperCase()}_WEBHOOK_SECRET`] ?? undefined;
}

export async function POST(req: NextRequest) {
  const platform = resolvePlatform(req);
  if (!platform) {
    return NextResponse.json({ error: "missing or invalid ?platform= query" }, { status: 400 });
  }
  const raw = await req.text();
  const headers = collectHeaders(req);

  const adapter = getAdapter(platform as Parameters<typeof getAdapter>[0]);

  // Every platform must verify signatures. For HMAC-based platforms we
  // verify centrally with the per-account secret (or env-level token).
  const secret = lookupSecret(platform);
  let verified = false;
  switch (platform) {
    case "facebook":
    case "instagram":
    case "threads":
      verified = secret ? verifyHubSignature(secret, raw, headers["x-hub-signature-256"]) : false;
      break;
    case "tiktok":
      verified = secret ? verifyHmacHeader(secret, raw, headers["x-webhook-signature"] ?? headers["signature"]) : false;
      break;
    case "youtube":
    case "pinterest":
    case "reddit":
    case "linkedin":
    case "mastodon":
    case "bluesky":
    case "x":
    case "discord":
      verified = secret ? verifyHmacHeader(secret, raw, headers["x-webhook-signature"] ?? headers["signature"]) : false;
      break;
    default:
      verified = false;
  }

  // Fall back to the adapter's own verifier (some platforms ship real ones).
  if (!verified) {
    verified = adapter.verifyWebhookSignature(raw, headers);
  }

  if (!verified) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Challenge response (Facebook-style hub handshake in a POST body).
  try {
    const json = JSON.parse(raw) as { challenge?: string };
    if (typeof json.challenge === "string") {
      return new NextResponse(json.challenge, { headers: { "content-type": "text/plain" } });
    }
  } catch { /* not JSON */ }

  const events = adapter.parseWebhookEvent(raw, headers);
  for (const e of events) {
    console.log(`[webhook ${platform}] kind=${e.kind}`);
  }
  return NextResponse.json({ ok: true, events: events.length });
}

export async function GET(req: NextRequest) {
  const platform = resolvePlatform(req);
  if (!platform) {
    return NextResponse.json({ error: "missing or invalid ?platform= query" }, { status: 400 });
  }
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (mode && token && challenge) {
    const expected = lookupSecret(platform);
    const resolved = resolveHubChallenge(mode, token, challenge, expected ?? "");
    if (resolved) {
      return new NextResponse(resolved, { headers: { "content-type": "text/plain" } });
    }
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
