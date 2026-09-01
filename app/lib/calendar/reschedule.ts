/**
 * Where a post lands when it is dragged onto a different day.
 *
 * Dragging changes the date and nothing else: a post set for 09:00 that moves
 * to Thursday should still go out at 09:00, not snap back to midnight. Posts
 * that never had a time get a 09:00 default rather than 00:00, which is almost
 * never what someone dropping a draft onto a day means.
 */
export const DEFAULT_HOUR = 9;

export interface RescheduleResult {
  ok: boolean;
  /** Unix seconds for the new slot; present only when ok. */
  scheduledFor?: number;
  reason?: string;
}

export function rescheduleTo(
  currentScheduledFor: number | null,
  day: { year: number; month: number; date: number },
  opts: { now?: number } = {},
): RescheduleResult {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const existing = currentScheduledFor ? new Date(currentScheduledFor * 1000) : null;
  const target = new Date(
    day.year,
    day.month,
    day.date,
    existing?.getHours() ?? DEFAULT_HOUR,
    existing?.getMinutes() ?? 0,
    0,
    0,
  );
  const ts = Math.floor(target.getTime() / 1000);
  // The API would silently demote a past time to a draft, which reads as the
  // drag having been ignored. Refuse it here and say why.
  if (ts <= now) return { ok: false, reason: "That slot is in the past — pick a later day." };
  return { ok: true, scheduledFor: ts };
}

/** Statuses that can still be moved. Anything already handed to a platform cannot. */
export const MOVABLE_STATUSES = ["draft", "scheduled", "failed"] as const;

export function isMovable(status: string): boolean {
  return (MOVABLE_STATUSES as readonly string[]).includes(status);
}
