import { NextResponse } from "next/server";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { analyticsSnapshots, posts, accounts } from "@db/schema";
import { requireSession } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { totalsFor, toCsv, type Snapshot } from "@/lib/analytics/aggregate";
import { resolveWindow } from "@/lib/analytics/window";

export const runtime = "nodejs";

function isoDay(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try { await requireSession(); } catch (e) { return authErrorResponse(e); }
  await runMigrations();
  const params = new URL(req.url).searchParams;

  const window = resolveWindow({
    days: params.get("days"),
    from: params.get("from"),
    to: params.get("to"),
  });
  if (!window.ok) return NextResponse.json({ error: window.reason }, { status: 400 });

  const accountParam = params.get("accountId");
  const accountId = accountParam ? Number(accountParam) : null;
  if (accountParam && (!Number.isInteger(accountId) || accountId! <= 0)) {
    return NextResponse.json({ error: "invalid accountId" }, { status: 400 });
  }

  const conditions = [
    gte(analyticsSnapshots.capturedAt, window.since),
    lte(analyticsSnapshots.capturedAt, window.until),
  ];
  if (accountId) conditions.push(eq(analyticsSnapshots.accountId, accountId));

  const snaps = db.select().from(analyticsSnapshots).where(and(...conditions)).all();

  const byPost = new Map<number, Snapshot[]>();
  for (const r of snaps) {
    const list = byPost.get(r.postId) ?? [];
    list.push(r);
    byPost.set(r.postId, list);
  }

  const rows = db
    .select({
      id: posts.id,
      caption: posts.caption,
      status: posts.status,
      publishedAt: posts.publishedAt,
      platformPostUrl: posts.platformPostUrl,
      accountLabel: accounts.label,
      platform: accounts.platform,
    })
    .from(posts)
    .leftJoin(accounts, eq(posts.accountId, accounts.id))
    .orderBy(desc(posts.publishedAt))
    .all()
    // Only posts with data inside the window belong in the export; the rest
    // would be rows of zeroes that look like real underperformance.
    .filter((p) => byPost.has(p.id));

  const csv = toCsv(
    [
      "post_id", "account", "platform", "status", "published_at", "url",
      "caption", "impressions", "reach", "likes", "comments", "shares",
      "saves", "video_views", "watch_time_ms", "engagement_rate", "snapshots",
    ],
    rows.map((p) => {
      const t = totalsFor(byPost.get(p.id) ?? []);
      return [
        p.id,
        p.accountLabel ?? "",
        p.platform ?? "",
        p.status,
        p.publishedAt ? new Date(p.publishedAt * 1000).toISOString() : "",
        p.platformPostUrl ?? "",
        p.caption,
        t.impressions, t.reach, t.likes, t.comments, t.shares,
        t.saves, t.videoViews, t.watchTimeMs, t.engagementRate.toFixed(6), t.postCount,
      ];
    }),
  );

  const name = `socmed-analytics-${isoDay(window.since)}_to_${isoDay(window.until)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      // The export reflects a moment in time; a cached copy would be wrong.
      "cache-control": "no-store",
    },
  });
}
