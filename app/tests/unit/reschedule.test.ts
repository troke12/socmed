import { describe, it, expect } from "vitest";
import { rescheduleTo, isMovable, DEFAULT_HOUR } from "@/lib/calendar/reschedule";

// Local time throughout: the calendar grid is rendered in the viewer's zone, so
// a drop onto "the 14th" means the 14th where they are sitting.
const localTs = (y: number, m: number, d: number, h = 0, min = 0) =>
  Math.floor(new Date(y, m, d, h, min, 0, 0).getTime() / 1000);

describe("rescheduleTo", () => {
  const now = localTs(2026, 8, 1, 12); // 2026-09-01 12:00 local

  it("keeps the time of day and moves only the date", () => {
    const current = localTs(2026, 8, 2, 14, 30);
    const r = rescheduleTo(current, { year: 2026, month: 8, date: 10 }, { now });
    expect(r.ok).toBe(true);
    // 14:30 must survive the move; snapping to midnight would silently change
    // when the post goes out.
    expect(r.scheduledFor).toBe(localTs(2026, 8, 10, 14, 30));
  });

  it("defaults an unscheduled draft to 09:00 rather than midnight", () => {
    const r = rescheduleTo(null, { year: 2026, month: 8, date: 10 }, { now });
    expect(r.scheduledFor).toBe(localTs(2026, 8, 10, DEFAULT_HOUR, 0));
  });

  it("refuses a day in the past", () => {
    const r = rescheduleTo(localTs(2026, 8, 2, 14, 30), { year: 2026, month: 7, date: 20 }, { now });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/past/);
    expect(r.scheduledFor).toBeUndefined();
  });

  it("refuses today when the resulting time has already passed", () => {
    // 09:00 default against a 12:00 "now" is earlier today, not later.
    const r = rescheduleTo(null, { year: 2026, month: 8, date: 1 }, { now });
    expect(r.ok).toBe(false);
  });

  it("accepts today when the kept time is still ahead", () => {
    const current = localTs(2026, 8, 5, 18, 0);
    const r = rescheduleTo(current, { year: 2026, month: 8, date: 1 }, { now });
    expect(r.ok).toBe(true);
    expect(r.scheduledFor).toBe(localTs(2026, 8, 1, 18, 0));
  });

  it("crosses a month boundary", () => {
    const current = localTs(2026, 8, 30, 8, 15);
    const r = rescheduleTo(current, { year: 2026, month: 9, date: 3 }, { now });
    expect(r.scheduledFor).toBe(localTs(2026, 9, 3, 8, 15));
  });
});

describe("isMovable", () => {
  it("allows the statuses that have not reached a platform", () => {
    expect(isMovable("draft")).toBe(true);
    expect(isMovable("scheduled")).toBe(true);
    // A failed post can be retried on a new day.
    expect(isMovable("failed")).toBe(true);
  });

  it("refuses anything already handed over", () => {
    // 'publishing' is mid-flight; moving it would race the worker.
    expect(isMovable("publishing")).toBe(false);
    expect(isMovable("published")).toBe(false);
    expect(isMovable("archived")).toBe(false);
  });
});
