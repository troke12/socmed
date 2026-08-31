import { describe, it, expect } from "vitest";
import { totalsFor, timeseriesByDay, breakdownByPlatform, topPosts, type Snapshot } from "@/lib/analytics/aggregate";

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    capturedAt: 0,
    impressions: 100,
    reach: 80,
    likes: 5,
    comments: 2,
    shares: 1,
    saves: 0,
    videoViews: 0,
    watchTimeMs: 0,
    engagementRate: 0,
    ...over,
  };
}

describe("totalsFor", () => {
  it("sums all metrics", () => {
    const t = totalsFor([snap(), snap({ likes: 10 })]);
    expect(t.likes).toBe(15);
    expect(t.impressions).toBe(200);
    expect(t.postCount).toBe(2);
  });
  it("computes engagement rate", () => {
    const t = totalsFor([snap({ impressions: 1000, likes: 50, comments: 20, shares: 10 })]);
    expect(t.engagementRate).toBeCloseTo(0.08);
  });
  it("handles empty list", () => {
    const t = totalsFor([]);
    expect(t.postCount).toBe(0);
    expect(t.engagementRate).toBe(0);
  });
});

describe("timeseriesByDay", () => {
  it("groups by day", () => {
    const day1 = new Date("2025-01-01T12:00:00Z").getTime() / 1000;
    const day2 = new Date("2025-01-02T12:00:00Z").getTime() / 1000;
    const ts = timeseriesByDay([
      snap({ capturedAt: day1, impressions: 100 }),
      snap({ capturedAt: day1, impressions: 50 }),
      snap({ capturedAt: day2, impressions: 200 }),
    ]);
    expect(ts).toHaveLength(2);
    expect(ts[0]!.impressions).toBe(150);
    expect(ts[1]!.impressions).toBe(200);
  });
});

describe("breakdownByPlatform", () => {
  it("groups and sorts by impressions", () => {
    type WithPlatform = Snapshot & { platform: string };
    const a: WithPlatform = { ...snap(), platform: "x" };
    const b: WithPlatform = { ...snap(), platform: "linkedin" };
    const out = breakdownByPlatform(
      [a, b].map((s) => ({ ...s, impressions: s.platform === "x" ? 50 : 200 })),
      (s) => (s as WithPlatform).platform,
    );
    expect(out[0]!.platform).toBe("linkedin");
  });
});

describe("topPosts", () => {
  it("ranks by engagement", () => {
    type WithPostId = Snapshot & { postId: number };
    const snaps: WithPostId[] = [
      { ...snap(), postId: 1, likes: 1 },
      { ...snap(), postId: 2, likes: 100, impressions: 1000 },
    ];
    const meta = new Map<number, { caption: string }>([
      [1, { caption: "low" }],
      [2, { caption: "high" }],
    ]);
    const top = topPosts(snaps as unknown as Snapshot[], meta as unknown as Map<number, { caption: string; url?: string; platform?: string }>);
    expect(top[0]!.postId).toBe(2);
  });
});
