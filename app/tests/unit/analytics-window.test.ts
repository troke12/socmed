import { describe, it, expect } from "vitest";
import { resolveWindow } from "@/lib/analytics/window";
import { toCsv, csvCell, breakdownBy, type Snapshot } from "@/lib/analytics/aggregate";

const DAY = 24 * 60 * 60;

describe("resolveWindow", () => {
  it("defaults to a 30-day rolling window", () => {
    const w = resolveWindow({});
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.days).toBe(30);
    expect(w.until - w.since).toBe(30 * DAY);
  });

  it("keeps the legacy days parameter working", () => {
    const w = resolveWindow({ days: "7" });
    expect(w.ok && w.days).toBe(7);
  });

  it("clamps an out-of-range days value instead of failing", () => {
    expect(resolveWindow({ days: "0" }).ok && resolveWindow({ days: "0" })).toMatchObject({ days: 1 });
    expect(resolveWindow({ days: "9999" })).toMatchObject({ days: 365 });
    // Garbage falls back to the default rather than producing NaN bounds.
    expect(resolveWindow({ days: "abc" })).toMatchObject({ days: 30 });
  });

  it("uses an explicit range when given, overriding days", () => {
    const from = 1_700_000_000;
    const to = from + 10 * DAY;
    const w = resolveWindow({ days: "90", from: String(from), to: String(to) });
    expect(w).toMatchObject({ ok: true, since: from, until: to, days: 10 });
  });

  it("treats a lone `from` as running up to now", () => {
    const from = Math.floor(Date.now() / 1000) - 5 * DAY;
    const w = resolveWindow({ from: String(from) });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.since).toBe(from);
    expect(w.until).toBeGreaterThanOrEqual(from);
  });

  it("rejects an inverted range", () => {
    const w = resolveWindow({ from: "2000", to: "1000" });
    expect(w).toMatchObject({ ok: false });
    expect(w.ok === false && w.reason).toMatch(/before/);
  });

  it("rejects a `to` with no `from`", () => {
    // Otherwise the window silently starts at the epoch and scans everything.
    expect(resolveWindow({ to: "1700000000" })).toMatchObject({ ok: false });
  });

  it("rejects an absurdly large range", () => {
    const w = resolveWindow({ from: "0", to: String(6 * 365 * DAY) });
    expect(w).toMatchObject({ ok: false });
    expect(w.ok === false && w.reason).toMatch(/too large/);
  });

  it("rejects non-numeric bounds", () => {
    expect(resolveWindow({ from: "yesterday", to: "today" })).toMatchObject({ ok: false });
  });
});

describe("CSV escaping", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes a value containing a comma", () => {
    // Unquoted, this shifts every following column in the row.
    expect(csvCell("hello, world")).toBe('"hello, world"');
  });

  it("doubles embedded quotes", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("survives a caption built to break a naive writer", () => {
    const caption = 'Big news, "finally"!\nRead more →';
    const csv = toCsv(["id", "caption"], [[1, caption]]);
    const [header, ...rest] = csv.split("\r\n");
    expect(header).toBe("id,caption");
    // The embedded newline stays inside the quoted field, so the row spans two
    // physical lines and that is correct per RFC 4180.
    expect(rest.join("\r\n")).toBe('1,"Big news, ""finally""!\nRead more →"');
  });

  it("separates rows with CRLF", () => {
    expect(toCsv(["a"], [[1], [2]])).toBe("a\r\n1\r\n2");
  });
});

describe("breakdownBy", () => {
  const snap = (over: Partial<Snapshot> & { key: string }): Snapshot & { key: string } => ({
    capturedAt: 0, impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0,
    saves: 0, videoViews: 0, watchTimeMs: 0, engagementRate: 0, ...over,
  });

  it("groups by an arbitrary key and sorts by impressions", () => {
    const rows = [
      snap({ key: "a", impressions: 100, likes: 10 }),
      snap({ key: "b", impressions: 300, likes: 5 }),
      snap({ key: "a", impressions: 50, likes: 2 }),
    ];
    const out = breakdownBy(rows, (s) => s.key);
    expect(out.map((r) => r.key)).toEqual(["b", "a"]);
    expect(out.find((r) => r.key === "a")?.impressions).toBe(150);
    expect(out.find((r) => r.key === "a")?.likes).toBe(12);
  });

  it("keeps two accounts on the same platform apart", () => {
    const rows = [
      snap({ key: "7", impressions: 100 }),
      snap({ key: "8", impressions: 40 }),
    ];
    // The whole point of the per-account breakdown.
    expect(breakdownBy(rows, (s) => s.key)).toHaveLength(2);
  });
});
