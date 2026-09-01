import { describe, it, expect } from "vitest";
import { parseCron, isValidCron, isValidTimezone, nextCronRun, describeCron } from "@/lib/schedule/cron";

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;

describe("cron parsing", () => {
  it("rejects expressions that are not five fields", () => {
    expect(() => parseCron("0 9 * *")).toThrow(/expected 5 fields/);
    expect(() => parseCron("0 9 * * * *")).toThrow(/expected 5 fields/);
  });

  it("rejects out-of-range and malformed values", () => {
    expect(isValidCron("60 9 * * *")).toBe(false);
    expect(isValidCron("0 24 * * *")).toBe(false);
    expect(isValidCron("0 9 0 * *")).toBe(false);
    expect(isValidCron("0 9 * 13 *")).toBe(false);
    expect(isValidCron("0 9 * * 8")).toBe(false);
    expect(isValidCron("0 9 * * 5-1")).toBe(false);
    expect(isValidCron("*/0 9 * * *")).toBe(false);
    expect(isValidCron("0,, 9 * * *")).toBe(false);
  });

  it("expands ranges, lists and steps", () => {
    expect([...parseCron("0 9 * * 1-5").dow]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron("0 */6 * * *").hour]).toEqual([0, 6, 12, 18]);
    expect([...parseCron("5/15 9 * * *").minute]).toEqual([5, 20, 35, 50]);
    expect([...parseCron("0 9 * * 0,3").dow]).toEqual([0, 3]);
  });

  it("treats day-of-week 7 as Sunday", () => {
    expect([...parseCron("0 9 * * 7").dow]).toEqual([0]);
  });

  it("tracks which day fields were restricted", () => {
    const both = parseCron("0 9 1 * 1");
    expect(both.domRestricted).toBe(true);
    expect(both.dowRestricted).toBe(true);
    const neither = parseCron("0 9 * * *");
    expect(neither.domRestricted).toBe(false);
    expect(neither.dowRestricted).toBe(false);
  });
});

describe("nextCronRun", () => {
  it("finds the next daily occurrence in UTC", () => {
    // 2026-09-01 is a Tuesday. 00:00Z is before 09:00Z the same day.
    expect(nextCronRun("0 9 * * *", "UTC", utc(2026, 9, 1))).toBe(utc(2026, 9, 1, 9));
    // Exactly on a fire time returns the *next* one, never the same instant.
    expect(nextCronRun("0 9 * * *", "UTC", utc(2026, 9, 1, 9))).toBe(utc(2026, 9, 2, 9));
  });

  it("honours day-of-week", () => {
    // Next Monday after Tue 2026-09-01 is 2026-09-07.
    expect(nextCronRun("0 9 * * 1", "UTC", utc(2026, 9, 1))).toBe(utc(2026, 9, 7, 9));
  });

  it("honours a fixed timezone offset", () => {
    // Asia/Jakarta is UTC+7 year-round: 09:00 local == 02:00Z.
    expect(nextCronRun("0 9 * * *", "Asia/Jakarta", utc(2026, 9, 1))).toBe(utc(2026, 9, 1, 2));
  });

  it("applies Vixie OR semantics when both day fields are restricted", () => {
    // "1st of the month OR any Monday". From Tue 2026-09-01, the next hit is
    // Mon 2026-09-07 — not 2026-10-01, which a naive AND would pick.
    expect(nextCronRun("0 9 1 * 1", "UTC", utc(2026, 9, 1, 12))).toBe(utc(2026, 9, 7, 9));
  });

  it("crosses month and year boundaries", () => {
    expect(nextCronRun("0 9 1 * *", "UTC", utc(2026, 12, 2))).toBe(utc(2027, 1, 1, 9));
    expect(nextCronRun("0 9 29 2 *", "UTC", utc(2026, 1, 1))).toBe(utc(2028, 2, 29, 9));
  });

  it("throws when the expression can never match", () => {
    expect(() => nextCronRun("0 9 30 2 *", "UTC", utc(2026, 1, 1))).toThrow(/no run time/);
  });

  it("rejects an unknown timezone", () => {
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(() => nextCronRun("0 9 * * *", "Mars/Olympus", utc(2026, 9, 1))).toThrow();
  });

  describe("daylight saving", () => {
    // US DST 2026: forward Sun Mar 8 02:00 EST -> 03:00 EDT,
    //              back    Sun Nov 1 02:00 EDT -> 01:00 EST.
    it("keeps a fixed local time across the spring transition", () => {
      // Fri Mar 6 12:00Z. Next 09:00 EST is Mar 6 14:00Z (UTC-5)...
      expect(nextCronRun("0 9 * * *", "America/New_York", utc(2026, 3, 6, 12))).toBe(utc(2026, 3, 6, 14));
      // ...and after the switch the same rule fires at 13:00Z (UTC-4).
      expect(nextCronRun("0 9 * * *", "America/New_York", utc(2026, 3, 8, 12))).toBe(utc(2026, 3, 8, 13));
    });

    it("skips a local time that the spring-forward gap deletes", () => {
      // 02:30 does not exist on Mar 8. From Mar 7 12:00Z (07:00 EST) the run
      // that day has passed, so the next real occurrence is Mar 9 02:30 EDT.
      expect(nextCronRun("30 2 * * *", "America/New_York", utc(2026, 3, 7, 12))).toBe(utc(2026, 3, 9, 6, 30));
    });

    it("picks the first pass of an ambiguous fall-back hour", () => {
      // 01:30 happens twice on Nov 1. The pre-transition (EDT, UTC-4) instant wins.
      expect(nextCronRun("30 1 * * *", "America/New_York", utc(2026, 10, 31, 12))).toBe(utc(2026, 11, 1, 5, 30));
    });

    it("always advances — repeated calls never stall or go backwards", () => {
      let t = utc(2026, 3, 6);
      for (let i = 0; i < 200; i++) {
        const next = nextCronRun("30 2 * * *", "America/New_York", t);
        expect(next).toBeGreaterThan(t);
        t = next;
      }
    });
  });
});

describe("describeCron", () => {
  it("renders the shapes offered as presets", () => {
    expect(describeCron("0 9 * * *")).toBe("every day at 09:00");
    expect(describeCron("0 9 * * 1")).toBe("on Mon at 09:00");
    expect(describeCron("0 12 * * 1-5")).toBe("on Mon, Tue, Wed, Thu and Fri at 12:00");
    expect(describeCron("0 9 1 * *")).toBe("on day 1 at 09:00");
    expect(describeCron("0 */6 * * *")).toBe("every day at 00:00, 06:00, 12:00 and 18:00");
  });

  it("says both when day-of-month and day-of-week are combined", () => {
    expect(describeCron("0 9 1 * 1")).toContain("or on day 1");
  });

  it("never throws on any expression it can parse", () => {
    for (const e of ["* * * * *", "*/5 * * * *", "0 0 1 1 *", "15,45 8-17 * * 1-5"]) {
      expect(() => describeCron(e)).not.toThrow();
      expect(describeCron(e).length).toBeGreaterThan(0);
    }
  });
});
