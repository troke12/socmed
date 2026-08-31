// Webhook ingress for all platforms. Uses ?platform=x in the query string
// instead of a dynamic [platform] path segment, which Next.js 14.2 dev server
// fails to register correctly under Node 24.
//
// Configure each platform's webhook URL in their dev console as:
//   https://your.domain/api/webhooks?platform=x

import { NextResponse, type NextRequest } from "next/server";
import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";

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

export async function POST(req: NextRequest) {
  const platform = resolvePlatform(req);
  if (!platform) {
    return NextResponse.json({ error: "missing or invalid ?platform= query" }, { status: 400 });
  }
  const raw = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });

  const adapter = getAdapter(platform as Parameters<typeof getAdapter>[0]);
  if (!adapter.verifyWebhookSignature(raw, headers)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  try {
    const json = JSON.parse(raw) as { challenge?: string };
    if (typeof json.challenge === "string") {
      return new NextResponse(json.challenge, { headers: { "content-type": "text/plain" } });
    }
  } catch { /* not JSON */ }

  const events = adapter.parseWebhookEvent(raw, headers);
  for (const e of events) {
    // eslint-disable-next-line no-console
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
  if (mode === "subscribe" && token && challenge) {
    const expected = process.env[`${platform.toUpperCase()}_WEBHOOK_VERIFY_TOKEN`];
    if (expected && token === expected) {
      return new NextResponse(challenge, { headers: { "content-type": "text/plain" } });
    }
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
