import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { analyticsSnapshots, posts, accounts } from "@db/schema";
import { requireSession } from "@/lib/auth/require";
import { totalsFor, type Snapshot } from "@/lib/analytics/aggregate";

export const runtime = "nodejs";

export async function GET() {
  try { requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  await runMigrations();
  // Per-post totals
  const allPosts = db
    .select({
      id: posts.id,
      accountId: posts.accountId,
      platform: accounts.platform,
      handle: accounts.handle,
      caption: posts.caption,
      status: posts.status,
      publishedAt: posts.publishedAt,
      platformPostUrl: posts.platformPostUrl,
    })
    .from(posts)
    .leftJoin(accounts, eq(posts.accountId, accounts.id))
    .orderBy(desc(posts.createdAt))
    .all();

  const rows = db.select().from(analyticsSnapshots).all();
  const byPost = new Map<number, Snapshot[]>();
  for (const r of rows) {
    const list = byPost.get(r.postId) ?? [];
    list.push({
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
    });
    byPost.set(r.postId, list);
  }
  const out = allPosts.map((p) => {
    const snaps = byPost.get(p.id) ?? [];
    const t = totalsFor(snaps);
    return { ...p, ...t };
  });
  return NextResponse.json({ posts: out });
}
