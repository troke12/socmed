import { describe, it, expect } from "vitest";
import {
  bestTimeSlots,
  slotOf,
  nextOccurrence,
  CONFIDENT_SAMPLE,
  type PostPerformance,
} from "@/lib/analytics/best-time";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function post(id: number, iso: string, impressions: number, engagements: number): PostPerformance {
  return { postId: id, publishedAt: at(iso), impressions, engagements };
}

describe("slotOf", () => {
  it("buckets by the requested timezone, not the server's", () => {
    // 2026-09-01T23:30Z is Tuesday late evening in UTC, but already Wednesday
    // morning in Jakarta (UTC+7).
    const ts = at("2026-09-01T23:30:00Z");
    expect(slotOf(ts, "UTC")).toEqual({ weekday: 2, hour: 23 });
    expect(slotOf(ts, "Asia/Jakarta")).toEqual({ weekday: 3, hour: 6 });
  });

  it("respects daylight saving", () => {
    // 2026-07-01T12:00Z is 08:00 EDT (UTC-4); in January it would be 07:00 EST.
    expect(slotOf(at("2026-07-01T12:00:00Z"), "America/New_York").hour).toBe(8);
    expect(slotOf(at("2026-01-01T12:00:00Z"), "America/New_York").hour).toBe(7);
  });
});

describe("bestTimeSlots", () => {
  it("ranks slots by average engagement rate", () => {
    const posts = [
      // Tuesday 09:00 — 10%
      post(1, "2026-09-01T09:00:00Z", 1000, 100),
      post(2, "2026-09-08T09:00:00Z", 1000, 100),
      // Friday 20:00 — 2%
      post(3, "2026-09-04T20:00:00Z", 1000, 20),
      post(4, "2026-09-11T20:00:00Z", 1000, 20),
    ];
    const r = bestTimeSlots(posts, { timezone: "UTC" });
    expect(r.slots[0]).toMatchObject({ weekday: 2, hour: 9, postCount: 2 });
    expect(r.slots[0]!.avgEngagementRate).toBeCloseTo(0.1);
    expect(r.slots[1]).toMatchObject({ weekday: 5, hour: 20 });
  });

  it("ignores slots below the minimum sample", () => {
    const posts = [
      post(1, "2026-09-01T09:00:00Z", 1000, 500), // one lucky post, 50%
      post(2, "2026-09-04T20:00:00Z", 1000, 20),
      post(3, "2026-09-11T20:00:00Z", 1000, 20),
    ];
    const r = bestTimeSlots(posts, { timezone: "UTC" });
    // A single 50% post is noise, not a Tuesday-morning finding.
    expect(r.slots.map((s) => s.hour)).toEqual([20]);
  });

  it("counts each post once regardless of how often it was polled", () => {
    // The caller collapses snapshots to one peak row per post; this asserts the
    // function does not re-weight by anything else.
    const posts = [post(1, "2026-09-01T09:00:00Z", 1000, 100), post(2, "2026-09-08T09:00:00Z", 1000, 300)];
    const r = bestTimeSlots(posts, { timezone: "UTC" });
    expect(r.slots[0]!.postCount).toBe(2);
    expect(r.slots[0]!.avgEngagementRate).toBeCloseTo(0.2); // mean of 10% and 30%
  });

  it("treats a post with no reported impressions as zero, not infinite", () => {
    // Mastodon and Discord do not report impressions. Dividing by zero, or
    // falling back to the raw engagement count, would make them dominate.
    const posts = [
      post(1, "2026-09-01T09:00:00Z", 0, 50),
      post(2, "2026-09-08T09:00:00Z", 0, 50),
      post(3, "2026-09-04T20:00:00Z", 1000, 10),
      post(4, "2026-09-11T20:00:00Z", 1000, 10),
    ];
    const r = bestTimeSlots(posts, { timezone: "UTC" });
    expect(r.slots[0]).toMatchObject({ hour: 20 });
    expect(r.slots.find((s) => s.hour === 9)?.avgEngagementRate).toBe(0);
  });

  it("breaks a tie on sample size", () => {
    const posts = [
      post(1, "2026-09-01T09:00:00Z", 100, 10),
      post(2, "2026-09-08T09:00:00Z", 100, 10),
      post(3, "2026-09-15T09:00:00Z", 100, 10),
      post(4, "2026-09-04T20:00:00Z", 100, 10),
      post(5, "2026-09-11T20:00:00Z", 100, 10),
    ];
    const r = bestTimeSlots(posts, { timezone: "UTC" });
    // Same 10% rate; the slot backed by three posts is the better bet.
    expect(r.slots[0]).toMatchObject({ hour: 9, postCount: 3 });
  });

  it("reports low confidence below the threshold", () => {
    const few = [post(1, "2026-09-01T09:00:00Z", 100, 10), post(2, "2026-09-08T09:00:00Z", 100, 10)];
    expect(bestTimeSlots(few, { timezone: "UTC" }).confident).toBe(false);

    const many = Array.from({ length: CONFIDENT_SAMPLE }, (_, i) =>
      post(i + 1, `2026-09-0${(i % 9) + 1}T09:00:00Z`, 100, 10),
    );
    expect(bestTimeSlots(many, { timezone: "UTC" }).confident).toBe(true);
  });

  it("returns empty results for no history without throwing", () => {
    const r = bestTimeSlots([], { timezone: "UTC" });
    expect(r.slots).toEqual([]);
    expect(r.sampleSize).toBe(0);
    expect(r.confident).toBe(false);
  });

  it("still reports weekday and hour rollups when no slot qualifies", () => {
    // Sparse history: every slot has one post, so slots[] is empty, but the
    // coarser rollups still carry signal.
    const posts = [post(1, "2026-09-01T09:00:00Z", 100, 30), post(2, "2026-09-04T20:00:00Z", 100, 5)];
    const r = bestTimeSlots(posts, { timezone: "UTC" });
    expect(r.slots).toEqual([]);
    expect(r.byWeekday[0]).toMatchObject({ weekday: 2 });
    expect(r.byHour[0]).toMatchObject({ hour: 9 });
  });
});

describe("nextOccurrence", () => {
  it("finds the next matching weekday", () => {
    const now = new Date(2026, 8, 1, 12, 0); // Tuesday 12:00 local
    const next = nextOccurrence({ weekday: 5, hour: 20 }, now); // Friday 20:00
    expect(next.getDay()).toBe(5);
    expect(next.getHours()).toBe(20);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("rolls to next week when today's hour has passed", () => {
    const now = new Date(2026, 8, 1, 12, 0); // Tuesday 12:00
    const next = nextOccurrence({ weekday: 2, hour: 9 }, now); // Tuesday 09:00
    // Scheduling in the past would just be rejected by the API.
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getDate()).toBe(8);
  });

  it("keeps today when the hour is still ahead", () => {
    const now = new Date(2026, 8, 1, 12, 0);
    const next = nextOccurrence({ weekday: 2, hour: 18 }, now);
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(18);
  });
});
