import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, sqlite } from "@db/client";
import { runMigrations } from "@db/migrate";
import { audienceSnapshots, accounts } from "@db/schema";
import { requireSession } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { resolveWindow } from "@/lib/analytics/window";
import { getAdapter } from "@platforms/registry";
import "@platforms/bootstrap";

export const runtime = "nodejs";

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
    gte(audienceSnapshots.capturedAt, window.since),
    lte(audienceSnapshots.capturedAt, window.until),
  ];
  if (accountId) conditions.push(eq(audienceSnapshots.accountId, accountId));

  const rows = db
    .select({
      accountId: audienceSnapshots.accountId,
      platform: audienceSnapshots.platform,
      capturedAt: audienceSnapshots.capturedAt,
      followers: audienceSnapshots.followers,
    })
    .from(audienceSnapshots)
    .where(and(...conditions))
    .orderBy(audienceSnapshots.capturedAt)
    .all();

  const labels = new Map(
    db.select({ id: accounts.id, label: accounts.label, platform: accounts.platform }).from(accounts).all()
      .map((a) => [a.id, a]),
  );

  // One point per day with a column per account, which is the shape a
  // multi-series line chart consumes directly.
  const byDay = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    if (r.followers === null) continue;
    const day = new Date(r.capturedAt * 1000).toISOString().slice(0, 10);
    const point = byDay.get(day) ?? { day };
    point[String(r.accountId)] = r.followers;
    byDay.set(day, point);
  }

  const seriesIds = [...new Set(rows.filter((r) => r.followers !== null).map((r) => r.accountId))];
  const series = seriesIds.map((id) => ({
    accountId: id,
    label: labels.get(id)?.label ?? `Account ${id}`,
    platform: labels.get(id)?.platform ?? "unknown",
  }));

  // Net change over the window, per account. Computed from the first and last
  // non-null point rather than by differencing every step, so a day the poller
  // missed does not read as a drop to zero and back.
  const growth = seriesIds.map((id) => {
    const points = rows.filter((r) => r.accountId === id && r.followers !== null);
    const first = points[0]?.followers ?? null;
    const last = points[points.length - 1]?.followers ?? null;
    return {
      accountId: id,
      label: labels.get(id)?.label ?? `Account ${id}`,
      first,
      last,
      change: first !== null && last !== null ? last - first : null,
    };
  });

  // Which connected accounts can never produce a point, so the UI can explain
  // an empty chart instead of looking broken.
  const unsupported = db
    .select({ id: accounts.id, label: accounts.label, platform: accounts.platform })
    .from(accounts)
    .where(eq(accounts.status, "active"))
    .all()
    .filter((a) => !getAdapter(a.platform).fetchAudience)
    .map((a) => ({ accountId: a.id, label: a.label, platform: a.platform }));

  return NextResponse.json({
    window: { since: window.since, until: window.until, days: window.days },
    points: [...byDay.values()],
    series,
    growth,
    unsupported,
    total: (sqlite.prepare(`SELECT COUNT(*) as n FROM audience_snapshots`).get() as { n: number }).n,
  });
}
