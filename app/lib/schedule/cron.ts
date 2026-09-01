/**
 * Minimal timezone-aware evaluator for standard 5-field cron expressions.
 *
 * Hand-rolled rather than pulled from npm on purpose: the worker compiles to
 * CommonJS (worker/tsconfig.json) while the app runs as ESM, and the popular
 * parsers are now ESM-only and drag in a full date library. All this needs is
 * "given an expression, a timezone and an instant, when is the next fire time".
 *
 * Supported syntax per field: `*`, `n`, `a-b`, `a,b,c`, `*\/s`, `a-b/s`.
 * Not supported: `@hourly`-style macros, `L`/`W`/`#`, seconds, or year fields.
 */

const FIELD_RANGES = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (0 and 7 both mean Sunday)
] as const;

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  // Vixie cron: when BOTH day-of-month and day-of-week are restricted, a day
  // matches if EITHER matches. Tracking which fields were literally `*` is the
  // only way to reproduce that, since an expanded `*` is indistinguishable from
  // an explicit full range once it is a Set.
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(raw: string, index: number): Set<number> {
  const { min, max } = FIELD_RANGES[index]!;
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (piece === "") throw new Error(`cron: empty item in field "${raw}"`);
    const [rangePart, stepPart] = piece.split("/");
    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step < 1) throw new Error(`cron: bad step "${piece}"`);
    }
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart!.includes("-")) {
      const [a, b] = rangePart!.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(rangePart);
      // A bare value with a step means "from here to the end of the range"
      // (`5/15` in the minute field is 5,20,35,50), matching Vixie cron.
      hi = stepPart !== undefined ? max : lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`cron: bad value "${piece}"`);
    if (lo < min || hi > max || lo > hi) throw new Error(`cron: "${piece}" out of range ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron: expected 5 fields, got ${parts.length} in "${expr}"`);
  }
  const [minute, hour, dom, month, dowRaw] = parts as [string, string, string, string, string];
  const dow = parseField(dowRaw, 4);
  // Normalise 7 → 0 so weekday comparison against Date#getUTCDay works directly.
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }
  return {
    minute: parseField(minute, 0),
    hour: parseField(hour, 1),
    dom: parseField(dom, 2),
    month: parseField(month, 3),
    dow,
    domRestricted: dom !== "*",
    dowRestricted: dowRaw !== "*",
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    // Throws RangeError on an unknown zone, which is the validation we want.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timezone, f);
  }
  return f;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    formatterFor(timezone);
    return true;
  } catch {
    return false;
  }
}

/**
 * Offset of `timezone` from UTC, in seconds, at the given instant.
 * Derived by rendering the instant as wall-clock fields in the zone and
 * reinterpreting those fields as if they were UTC — the gap is the offset.
 */
function offsetSecAt(epochSec: number, timezone: string): number {
  const parts = formatterFor(timezone).formatToParts(new Date(epochSec * 1000));
  const f: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") f[p.type] = Number(p.value);
  }
  const asIfUtc =
    Date.UTC(f.year!, f.month! - 1, f.day!, f.hour!, f.minute!, f.second!) / 1000;
  return asIfUtc - epochSec;
}

// A "local timestamp": wall-clock fields packed into an epoch as if they were
// UTC. Only used for calendar arithmetic — it is not a real instant.
function toLocalTs(epochSec: number, timezone: string): number {
  return epochSec + offsetSecAt(epochSec, timezone);
}

function fromLocalTs(localTs: number, timezone: string): number {
  // The offset depends on the instant we are solving for, so guess with the
  // offset at the naive instant and re-solve. Two corrections converge for every
  // real-world zone; DST transitions are the only case needing the second pass.
  let guess = localTs - offsetSecAt(localTs, timezone);
  for (let i = 0; i < 3; i++) {
    const next = localTs - offsetSecAt(guess, timezone);
    if (next === guess) return guess;
    guess = next;
  }
  return guess;
}

function dayMatches(fields: CronFields, day: number, weekday: number): boolean {
  const domHit = fields.dom.has(day);
  const dowHit = fields.dow.has(weekday);
  if (fields.domRestricted && fields.dowRestricted) return domHit || dowHit;
  if (fields.domRestricted) return domHit;
  if (fields.dowRestricted) return dowHit;
  return true;
}

const MINUTE = 60;
const DAY = 24 * 60 * 60;
// Walking is coarse — whole months, days and hours are skipped in one step, and
// only a matching hour is scanned minute by minute — so a satisfiable expression
// resolves in well under a hundred steps. The cap exists so an unsatisfiable one
// (`0 0 30 2 *`) fails loudly instead of hanging the worker.
const MAX_STEPS = 20_000;

/**
 * Next instant (unix seconds) strictly after `afterEpochSec` at which `expr`
 * fires in `timezone`. Throws on a malformed expression, an unknown zone, or an
 * expression with no match within ~4 years (e.g. `0 0 30 2 *`).
 */
export function nextCronRun(expr: string, timezone: string, afterEpochSec: number): number {
  const fields = parseCron(expr);
  formatterFor(timezone);

  // Start at the next whole minute strictly after the reference instant.
  const start = (Math.floor(afterEpochSec / MINUTE) + 1) * MINUTE;
  let localTs = Math.floor(toLocalTs(start, timezone) / MINUTE) * MINUTE;

  for (let step = 0; step < MAX_STEPS; step++) {
    const d = new Date(localTs * 1000);
    const month = d.getUTCMonth() + 1;
    if (!fields.month.has(month)) {
      // Jump to 00:00 on the 1st of the next month.
      localTs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
      continue;
    }
    if (!dayMatches(fields, d.getUTCDate(), d.getUTCDay())) {
      localTs = Math.floor(localTs / DAY) * DAY + DAY;
      continue;
    }
    if (!fields.hour.has(d.getUTCHours())) {
      localTs = Math.floor(localTs / 3600) * 3600 + 3600;
      continue;
    }
    if (!fields.minute.has(d.getUTCMinutes())) {
      localTs += MINUTE;
      continue;
    }
    const epoch = fromLocalTs(localTs, timezone);
    // A wall-clock time inside a spring-forward gap never happens, so no instant
    // maps back to it — fromLocalTs oscillates between the two offsets and
    // settles on a neighbouring hour. Round-tripping is what detects that; skip
    // the occurrence instead of firing an hour early. On the ambiguous
    // fall-back hour the round-trip succeeds and the earlier (pre-transition)
    // instant wins, which is the conventional choice.
    if (toLocalTs(epoch, timezone) === localTs && epoch > afterEpochSec) return epoch;
    localTs += MINUTE;
  }
  throw new Error(`cron: "${expr}" has no run time within the search window`);
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function sorted(set: Set<number>): number[] {
  return [...set].sort((a, b) => a - b);
}

function joinList(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Plain-English rendering of a cron expression, for the schedule UI.
 *
 * Deliberately best-effort: it covers the shapes people actually write (a fixed
 * time on given weekdays / month days, and simple hourly steps) and falls back
 * to listing the matching values rather than trying to be exhaustive. The
 * authoritative answer is always the "next run" preview, which comes from
 * nextCronRun rather than from this string.
 */
export function describeCron(expr: string): string {
  const f = parseCron(expr);
  const minutes = sorted(f.minute);
  const hours = sorted(f.hour);

  let time: string;
  if (minutes.length === 1 && hours.length === 1) {
    time = `at ${pad(hours[0]!)}:${pad(minutes[0]!)}`;
  } else if (minutes.length === 1 && hours.length === 24) {
    time = `every hour at :${pad(minutes[0]!)}`;
  } else if (minutes.length === 1) {
    time = `at ${joinList(hours.map((h) => `${pad(h)}:${pad(minutes[0]!)}`))}`;
  } else if (minutes.length === 60) {
    time = hours.length === 24 ? "every minute" : `every minute of ${joinList(hours.map((h) => `${pad(h)}:00`))}`;
  } else {
    time = `at minutes ${joinList(minutes.map(String))} of ${
      hours.length === 24 ? "every hour" : joinList(hours.map((h) => `${pad(h)}:00`))
    }`;
  }

  const parts: string[] = [];
  if (f.dowRestricted) {
    parts.push(`on ${joinList(sorted(f.dow).map((d) => WEEKDAY_NAMES[d] ?? String(d)))}`);
  }
  if (f.domRestricted) {
    // Vixie's OR rule: with both fields set the run happens on either, so say so.
    parts.push(`${f.dowRestricted ? "or on day " : "on day "}${joinList(sorted(f.dom).map(String))}`);
  }
  const months = sorted(f.month);
  if (months.length !== 12) {
    parts.push(`in ${joinList(months.map((m) => MONTH_NAMES[m - 1] ?? String(m)))}`);
  }

  const when = parts.length === 0 ? "every day" : parts.join(" ");
  return `${time.startsWith("every") ? `${time}, ${when}` : `${when} ${time}`}`.replace(/\s+/g, " ").trim();
}
