// Edge-safe constants (no node:crypto here — middleware runs in Edge runtime).
export const SESSION_COOKIE_NAME = "socmed_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
