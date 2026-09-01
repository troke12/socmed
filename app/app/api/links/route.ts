import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { shortLinks, posts, accounts } from "@db/schema";
import { requireSession } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { shortenerEnabled, publicOrigin } from "@/lib/links/shorten";

export const runtime = "nodejs";

export async function GET() {
  try { await requireSession(); } catch (e) { return authErrorResponse(e); }
  await runMigrations();
  const rows = db
    .select({
      id: shortLinks.id,
      slug: shortLinks.slug,
      targetUrl: shortLinks.targetUrl,
      clicks: shortLinks.clicks,
      lastClickedAt: shortLinks.lastClickedAt,
      createdAt: shortLinks.createdAt,
      postId: shortLinks.postId,
      caption: posts.caption,
      accountLabel: accounts.label,
      platform: accounts.platform,
    })
    .from(shortLinks)
    .leftJoin(posts, eq(shortLinks.postId, posts.id))
    .leftJoin(accounts, eq(shortLinks.accountId, accounts.id))
    .orderBy(desc(shortLinks.createdAt))
    .all();

  return NextResponse.json({
    links: rows,
    // The UI needs to explain an empty list: no links exist because the feature
    // is off, versus none have been published yet.
    enabled: shortenerEnabled(),
    origin: publicOrigin(),
  });
}
