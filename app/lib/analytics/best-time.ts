/**
 * Best-time-to-post heuristic over data the app already collects.
 *
 * The signal is a post's *publish* time against how it went — not the snapshot
 * capture time, which only reflects when the poller happened to run. Each post
 * contributes once, using its best observed snapshot, so a post polled forty
 * times does not outweigh one polled twice.
 */

export interface PostPerformance {
  postId: number;
  /** Unix seconds the post actually went out. */
  publishedAt: number;
  impressions: number;
  /** likes + comments + shares */
  engagements: number;
}

export interface Slot {
  weekday: number; // 0 = Sunday
  hour: number; // 0-23, in the requested timezone
  postCount: number;
  avgEngagementRate: number;
  totalImpressions: number;
}

export interface BestTimeResult {
  slots: Slot[];
  byWeekday: Array<{ weekday: number; postCount: number; avgEngagementRate: number }>;
  byHour: Array<{ hour: number; postCount: number; avgEngagementRate: number }>;
  sampleSize: number;
  /**
   * Whether there is enough history to take the top slot seriously. Below this
   * the UI should present the numbers as an observation, not a recommendation —
   * three posts in a bucket is not evidence about Tuesdays.
   */
  confident: boolean;
}

export const MIN_POSTS_PER_SLOT = 2;
export const CONFIDENT_SAMPLE = 10;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    // Asking Intl for the weekday and hour directly avoids doing any offset
    // arithmetic here, and gets DST right for free.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timezone, f);
  }
  return f;
}

export function slotOf(unixSeconds: number, timezone: string): { weekday: number; hour: number } {
  const parts = formatterFor(timezone).formatToParts(new Date(unixSeconds * 1000));
  let weekday = 0;
  let hour = 0;
  for (const p of parts) {
    if (p.type === "weekday") weekday = WEEKDAY_INDEX[p.value] ?? 0;
    if (p.type === "hour") hour = Number(p.value) % 24;
  }
  return { weekday, hour };
}

function rate(engagements: number, impressions: number): number {
  // Impressions can legitimately be 0 on platforms that do not report them
  // (Mastodon, Discord). Falling back to raw engagement count would make those
  // posts dominate the ranking, so they contribute 0 instead.
  return impressions > 0 ? engagements / impressions : 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function bestTimeSlots(
  posts: PostPerformance[],
  opts: { timezone?: string; minPostsPerSlot?: number; limit?: number } = {},
): BestTimeResult {
  const timezone = opts.timezone || "UTC";
  const minPerSlot = opts.minPostsPerSlot ?? MIN_POSTS_PER_SLOT;
  const limit = opts.limit ?? 3;

  const bySlot = new Map<string, { weekday: number; hour: number; rates: number[]; impressions: number }>();
  const byWeekday = new Map<number, number[]>();
  const byHour = new Map<number, number[]>();

  for (const p of posts) {
    const { weekday, hour } = slotOf(p.publishedAt, timezone);
    const r = rate(p.engagements, p.impressions);
    const key = `${weekday}:${hour}`;
    const slot = bySlot.get(key) ?? { weekday, hour, rates: [], impressions: 0 };
    slot.rates.push(r);
    slot.impressions += p.impressions;
    bySlot.set(key, slot);

    byWeekday.set(weekday, [...(byWeekday.get(weekday) ?? []), r]);
    byHour.set(hour, [...(byHour.get(hour) ?? []), r]);
  }

  const slots: Slot[] = [...bySlot.values()]
    .filter((s) => s.rates.length >= minPerSlot)
    .map((s) => ({
      weekday: s.weekday,
      hour: s.hour,
      postCount: s.rates.length,
      avgEngagementRate: average(s.rates),
      totalImpressions: s.impressions,
    }))
    // Ties on rate are broken by sample size: a slot backed by six posts is a
    // better bet than the same number from two.
    .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate || b.postCount - a.postCount)
    .slice(0, limit);

  return {
    slots,
    byWeekday: [...byWeekday.entries()]
      .map(([weekday, rates]) => ({ weekday, postCount: rates.length, avgEngagementRate: average(rates) }))
      .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate),
    byHour: [...byHour.entries()]
      .map(([hour, rates]) => ({ hour, postCount: rates.length, avgEngagementRate: average(rates) }))
      .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate),
    sampleSize: posts.length,
    confident: posts.length >= CONFIDENT_SAMPLE,
  };
}

/**
 * Next calendar occurrence of a weekday/hour slot, strictly in the future.
 * Returned as local wall-clock fields for a datetime-local input rather than a
 * timestamp, since that is what the compose form binds to.
 */
export function nextOccurrence(
  slot: { weekday: number; hour: number },
  now: Date = new Date(),
): Date {
  const out = new Date(now.getFullYear(), now.getMonth(), now.getDate(), slot.hour, 0, 0, 0);
  let delta = (slot.weekday - out.getDay() + 7) % 7;
  // Today at an hour that has already passed means next week, not a time in
  // the past that the API would reject.
  if (delta === 0 && out.getTime() <= now.getTime()) delta = 7;
  out.setDate(out.getDate() + delta);
  return out;
}
