import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, sqlite } from "@db/client";
import { runMigrations } from "@db/migrate";
import { posts } from "@db/schema";
import { requireSession } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { bestTimeSlots, type PostPerformance } from "@/lib/analytics/best-time";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try { await requireSession(); } catch (e) { return authErrorResponse(e); }
  await runMigrations();
  const params = new URL(req.url).searchParams;

  const accountParam = params.get("accountId");
  const accountId = accountParam ? Number(accountParam) : null;
  if (accountParam && (!Number.isInteger(accountId) || accountId! <= 0)) {
    return NextResponse.json({ error: "invalid accountId" }, { status: 400 });
  }
  // Defaults to UTC so a missing or bogus zone still produces stable buckets
  // rather than throwing inside Intl.
  const timezone = params.get("tz") || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return NextResponse.json({ error: "unknown timezone" }, { status: 400 });
  }

  const published = db
    .select({ id: posts.id, publishedAt: posts.publishedAt })
    .from(posts)
    .where(
      accountId
        ? and(eq(posts.status, "published"), isNotNull(posts.publishedAt), eq(posts.accountId, accountId))
        : and(eq(posts.status, "published"), isNotNull(posts.publishedAt)),
    )
    .all();

  // One row per post, from its best observed snapshot. A post polled forty
  // times must not outweigh one polled twice, which is what summing every
  // snapshot would do.
  const peaks = sqlite
    .prepare(
      `SELECT post_id AS postId,
              MAX(impressions) AS impressions,
              MAX(likes + comments + shares) AS engagements
         FROM analytics_snapshots
        GROUP BY post_id`,
    )
    .all() as { postId: number; impressions: number; engagements: number }[];
  const peakByPost = new Map(peaks.map((p) => [p.postId, p]));

  const performance: PostPerformance[] = [];
  for (const p of published) {
    const peak = peakByPost.get(p.id);
    if (!peak) continue;
    performance.push({
      postId: p.id,
      publishedAt: p.publishedAt!,
      impressions: peak.impressions,
      engagements: peak.engagements,
    });
  }

  return NextResponse.json({ ...bestTimeSlots(performance, { timezone }), timezone });
}
