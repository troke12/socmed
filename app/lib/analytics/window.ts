const DAY = 24 * 60 * 60;
const MAX_DAYS = 365 * 5;

export type WindowResult =
  | { ok: true; since: number; until: number; days: number }
  | { ok: false; reason: string };

/**
 * Resolves an analytics time window from query params.
 *
 * `from`/`to` (unix seconds) win when supplied; `days` is the legacy rolling
 * window and stays the default so existing callers keep working. `to` is
 * inclusive of the whole day it names as far as the caller is concerned — the
 * UI sends an end-of-day timestamp — so nothing is clamped here beyond
 * rejecting an inverted or absurd range.
 */
export function resolveWindow(input: {
  days?: string | null;
  from?: string | null;
  to?: string | null;
}): WindowResult {
  const now = Math.floor(Date.now() / 1000);

  if (input.from || input.to) {
    const from = input.from ? Number(input.from) : null;
    const to = input.to ? Number(input.to) : now;
    if (from === null || !Number.isFinite(from) || !Number.isFinite(to)) {
      return { ok: false, reason: "from and to must be unix timestamps in seconds" };
    }
    if (from > to) {
      return { ok: false, reason: "from must be before to" };
    }
    if (to - from > MAX_DAYS * DAY) {
      return { ok: false, reason: `range is too large (max ${MAX_DAYS} days)` };
    }
    return { ok: true, since: Math.floor(from), until: Math.floor(to), days: Math.ceil((to - from) / DAY) };
  }

  const raw = Number(input.days ?? 30);
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(365, Math.floor(raw))) : 30;
  return { ok: true, since: now - days * DAY, until: now, days };
}
