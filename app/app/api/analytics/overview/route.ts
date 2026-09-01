import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@db/client";
import { analyticsSnapshots, posts, accounts } from "@db/schema";
import { requireSession } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { runMigrations } from "@db/migrate";
import { totalsFor, timeseriesByDay, breakdownBy, topPosts, type Snapshot } from "@/lib/analytics/aggregate";
import { resolveWindow } from "@/lib/analytics/window";

export const runtime = "nodejs";

type Row = Snapshot & { postId: number; platform: string; accountId: number };

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
  const { since, until } = window;

  const accountParam = params.get("accountId");
  const accountId = accountParam ? Number(accountParam) : null;
  if (accountParam && (!Number.isInteger(accountId) || accountId! <= 0)) {
    return NextResponse.json({ error: "invalid accountId" }, { status: 400 });
  }

  // Filtered in SQL. This used to load the whole snapshots table and filter in
  // JS, which grows unbounded with every poll of every published post.
  const conditions = [
    gte(analyticsSnapshots.capturedAt, since),
    lte(analyticsSnapshots.capturedAt, until),
  ];
  if (accountId) conditions.push(eq(analyticsSnapshots.accountId, accountId));

  const rows = db
    .select({
      postId: analyticsSnapshots.postId,
      accountId: analyticsSnapshots.accountId,
      platform: analyticsSnapshots.platform,
      capturedAt: analyticsSnapshots.capturedAt,
      impressions: analyticsSnapshots.impressions,
      reach: analyticsSnapshots.reach,
      likes: analyticsSnapshots.likes,
      comments: analyticsSnapshots.comments,
      shares: analyticsSnapshots.shares,
      saves: analyticsSnapshots.saves,
      videoViews: analyticsSnapshots.videoViews,
      watchTimeMs: analyticsSnapshots.watchTimeMs,
      engagementRate: analyticsSnapshots.engagementRate,
    })
    .from(analyticsSnapshots)
    .where(and(...conditions))
    .all() as Row[];

  const totals = totalsFor(rows);
  const timeseries = timeseriesByDay(rows);
  const byPlatform = breakdownBy(rows, (s) => s.platform).map(({ key, ...rest }) => ({
    platform: key,
    ...rest,
  }));

  // Per-account breakdown. Two accounts on the same platform were previously
  // indistinguishable, which is exactly the case an agency cares about.
  const accountLabels = new Map(
    db.select({ id: accounts.id, label: accounts.label, platform: accounts.platform }).from(accounts).all()
      .map((a) => [a.id, a]),
  );
  const byAccount = breakdownBy(rows, (s) => String(s.accountId)).map(({ key, ...rest }) => {
    const meta = accountLabels.get(Number(key));
    return {
      accountId: Number(key),
      label: meta?.label ?? `Account ${key}`,
      platform: meta?.platform ?? "unknown",
      ...rest,
    };
  });

  const postMeta = new Map<number, { caption: string; url?: string; platform?: string }>();
  for (const p of db.select().from(posts).all()) {
    postMeta.set(p.id, { caption: p.caption.slice(0, 80), url: p.platformPostUrl ?? undefined, platform: undefined });
  }
  const top = topPosts(rows, postMeta, 10);

  return NextResponse.json({
    window: { since, until, days: window.days },
    totals,
    timeseries,
    byPlatform,
    byAccount,
    top,
  });
}
