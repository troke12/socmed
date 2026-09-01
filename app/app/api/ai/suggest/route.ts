import { NextResponse } from "next/server";
import { z } from "zod";
import { runMigrations } from "@db/migrate";
import { requireRole } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { rateLimit } from "@/lib/security/rate-limit";
import { aiEnabled } from "@/lib/ai/config";
import { suggest, TONES, AiNotConfiguredError, AiRefusedError } from "@/lib/ai/suggest";
import { CONTENT_RULES } from "@platforms/content-rules";
import type { PlatformId } from "@/lib/platform-meta";

export const runtime = "nodejs";
// A model call can take a while; the default serverless ceiling would cut it off.
export const maxDuration = 60;

// Each call costs real money, so it is capped per user rather than left open to
// a stuck client retrying in a loop.
const LIMIT_PER_WINDOW = 20;
const WINDOW_MS = 5 * 60 * 1000;

const PLATFORM_IDS = Object.keys(CONTENT_RULES) as PlatformId[];

const Body = z.object({
  caption: z.string().max(5000),
  hashtags: z.string().max(2000).optional(),
  linkUrl: z.string().max(2000).optional().nullable(),
  platforms: z.array(z.enum(PLATFORM_IDS as [PlatformId, ...PlatformId[]])).max(12).default([]),
  tone: z.enum(TONES).default("keep"),
});

export async function GET() {
  try { await requireRole("editor"); } catch (e) { return authErrorResponse(e); }
  // Lets Compose hide the button entirely rather than offering something that
  // will only ever return an error.
  return NextResponse.json({ enabled: aiEnabled(), tones: TONES });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("editor"); } catch (e) { return authErrorResponse(e); }
  await runMigrations();

  if (!rateLimit(`ai:${actor.id}`, LIMIT_PER_WINDOW, WINDOW_MS)) {
    return NextResponse.json(
      { error: "too many suggestion requests — try again in a few minutes" },
      { status: 429 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  if (!parsed.data.caption.trim() && !parsed.data.hashtags?.trim() && !parsed.data.linkUrl) {
    return NextResponse.json({ error: "write something first — there is nothing to work from" }, { status: 400 });
  }

  try {
    const suggestion = await suggest({
      caption: parsed.data.caption,
      hashtags: parsed.data.hashtags,
      linkUrl: parsed.data.linkUrl ?? undefined,
      platforms: parsed.data.platforms,
      tone: parsed.data.tone,
    });
    return NextResponse.json(suggestion);
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    if (err instanceof AiRefusedError) {
      // Not a server fault, and not retryable — the author writes it themselves.
      return NextResponse.json(
        { error: `the model declined this request${err.category ? ` (${err.category})` : ""}` },
        { status: 422 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `suggestion failed: ${msg}` }, { status: 502 });
  }
}
