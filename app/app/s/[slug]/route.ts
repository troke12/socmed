import { NextResponse } from "next/server";
import { runMigrations } from "@db/migrate";
import { resolveAndCount } from "@/lib/links/shorten";

export const runtime = "nodejs";

/**
 * Public redirect for short links — deliberately unauthenticated, since the
 * audience clicking them are not app users.
 *
 * Only slugs this app minted resolve, and every target was supplied by an
 * authenticated user and validated as http(s) at creation time, so this is not
 * an open redirect: an attacker cannot get an arbitrary destination in here
 * without already having an account.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  await runMigrations();
  const link = resolveAndCount(slug);
  if (!link) {
    return NextResponse.json({ error: "unknown link" }, { status: 404 });
  }
  return NextResponse.redirect(link.targetUrl, {
    // 302, not 301: a permanent redirect would be cached by the browser and
    // every later click would never reach us to be counted.
    status: 302,
    headers: { "cache-control": "no-store" },
  });
}
