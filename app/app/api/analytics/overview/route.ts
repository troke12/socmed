import { NextResponse } from "next/server";
import { db } from "@db/client";
import { analyticsSnapshots, posts } from "@db/schema";
import { requireSession } from "@/lib/auth/require";
import { runMigrations } from "@db/migrate";
import { totalsFor, timeseriesByDay, breakdownByPlatform, topPosts, type Snapshot } from "@/lib/analytics/aggregate";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try { requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  await runMigrations();
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") ?? 30)));

  const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  const rows = db
    .select()
    .from(analyticsSnapshots)
    .all()
    .filter((r) => r.capturedAt >= since)
    .map((r) => ({
      postId: r.postId,
      platform: r.platform,
      capturedAt: r.capturedAt,
      impressions: r.impressions,
      reach: r.reach,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      saves: r.saves,
      videoViews: r.videoViews,
      watchTimeMs: r.watchTimeMs,
      engagementRate: r.engagementRate,
    })) as Array<Snapshot & { postId: number; platform: string }>;

  const totals = totalsFor(rows as unknown as Snapshot[]);
  const timeseries = timeseriesByDay(rows as unknown as Snapshot[]);
  const byPlatform = breakdownByPlatform(rows as unknown as Snapshot[], (r) => (r as unknown as { platform: string }).platform);

  // Build post meta for top posts
  const postMeta = new Map<number, { caption: string; url?: string; platform?: string }>();
  for (const p of db.select().from(posts).all()) {
    postMeta.set(p.id, { caption: p.caption.slice(0, 80), url: p.platformPostUrl ?? undefined, platform: undefined });
  }
  const top = topPosts(rows, postMeta, 10);

  return NextResponse.json({
    window: { days, since },
    totals,
    timeseries,
    byPlatform,
    top,
  });
}
