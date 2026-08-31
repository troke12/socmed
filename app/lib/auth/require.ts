import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, parseSessionCookie } from "./session";
import type { SessionPayload } from "./session";

export function requireSession(): SessionPayload {
  const cookie = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = parseSessionCookie(cookie);
  if (!session) {
    const err = new Error("unauthorized") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return session;
}

export function trySession(): SessionPayload | null {
  const cookie = cookies().get(SESSION_COOKIE_NAME)?.value;
  return parseSessionCookie(cookie);
}
