import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, parseSessionCookie } from "./session";
import type { SessionPayload } from "./session";

// Next.js 15+: cookies() is async.
export async function requireSession(): Promise<SessionPayload> {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = parseSessionCookie(cookie);
  if (!session) {
    const err = new Error("unauthorized") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return session;
}

export async function trySession(): Promise<SessionPayload | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return parseSessionCookie(cookie);
}
