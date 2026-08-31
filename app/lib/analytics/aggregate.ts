// Pure aggregation functions for analytics. Tested independently.

export interface Snapshot {
  capturedAt: number;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  videoViews: number;
  watchTimeMs: number;
  engagementRate: number;
}

export function totalsFor(snapshots: Snapshot[]): Omit<Snapshot, "capturedAt" | "engagementRate"> & { engagementRate: number; postCount: number } {
  const sum = (key: keyof Snapshot) => snapshots.reduce((acc, s) => acc + (s[key] as number || 0), 0);
  const impressions = sum("impressions");
  const reach = sum("reach");
  const likes = sum("likes");
  const comments = sum("comments");
  const shares = sum("shares");
  const saves = sum("saves");
  const videoViews = sum("videoViews");
  const watchTimeMs = sum("watchTimeMs");
  const engagementRate = impressions > 0 ? (likes + comments + shares) / impressions : 0;
  return { impressions, reach, likes, comments, shares, saves, videoViews, watchTimeMs, engagementRate, postCount: snapshots.length };
}

export function timeseriesByDay(snapshots: Snapshot[]): Array<{ day: string; impressions: number; engagement: number; likes: number; comments: number; shares: number }> {
  const byDay = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const d = new Date(s.capturedAt * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = byDay.get(key) ?? [];
    list.push(s);
    byDay.set(key, list);
  }
  const out: Array<{ day: string; impressions: number; engagement: number; likes: number; comments: number; shares: number }> = [];
  for (const [day, list] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const t = totalsFor(list);
    out.push({ day, impressions: t.impressions, engagement: t.engagementRate, likes: t.likes, comments: t.comments, shares: t.shares });
  }
  return out;
}

export function breakdownByPlatform(snapshots: Snapshot[], platformKey: (s: Snapshot) => string): Array<{ platform: string; impressions: number; engagement: number; likes: number; comments: number; shares: number; postCount: number }> {
  const groups = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const k = platformKey(s);
    const list = groups.get(k) ?? [];
    list.push(s);
    groups.set(k, list);
  }
  const out: Array<{ platform: string; impressions: number; engagement: number; likes: number; comments: number; shares: number; postCount: number }> = [];
  for (const [k, list] of groups) {
    const t = totalsFor(list);
    out.push({ platform: k, impressions: t.impressions, engagement: t.engagementRate, likes: t.likes, comments: t.comments, shares: t.shares, postCount: t.postCount });
  }
  return out.sort((a, b) => b.impressions - a.impressions);
}

export function topPosts(snapshots: Snapshot[], postMeta: Map<number, { caption: string; url?: string; platform?: string }>, limit = 10): Array<{ postId: number; caption: string; url?: string; platform?: string; engagement: number; impressions: number; likes: number; comments: number }> {
  const totals = new Map<number, Snapshot[]>();
  for (const s of snapshots) {
    // @ts-expect-error: we know the type
    const id: number = s.postId;
    const list = totals.get(id) ?? [];
    list.push(s);
    totals.set(id, list);
  }
  const out: Array<{ postId: number; caption: string; url?: string; platform?: string; engagement: number; impressions: number; likes: number; comments: number }> = [];
  for (const [postId, list] of totals) {
    const t = totalsFor(list);
    const meta = postMeta.get(postId);
    out.push({
      postId,
      caption: meta?.caption ?? `Post #${postId}`,
      url: meta?.url,
      platform: meta?.platform,
      engagement: t.engagementRate,
      impressions: t.impressions,
      likes: t.likes,
      comments: t.comments,
    });
  }
  return out.sort((a, b) => b.engagement - a.engagement).slice(0, limit);
}
