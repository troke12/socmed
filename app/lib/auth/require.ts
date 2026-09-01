import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@db/client";
import { users } from "@db/schema";
import { SESSION_COOKIE_NAME, parseSessionCookie } from "./session";
import { atLeast, type Role } from "./roles";

export interface AuthedUser {
  id: number;
  username: string;
  role: Role;
}

function unauthorized(message = "unauthorized"): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = 401;
  return err;
}

/**
 * Resolves the signed session cookie to a live user row.
 *
 * The lookup is per request rather than cached in the cookie so a role change,
 * a disable or a deletion takes effect immediately. Previously the cookie was
 * trusted on its own, which meant a deleted user's cookie kept working until it
 * expired — up to 30 days.
 */
export async function requireSession(): Promise<AuthedUser> {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = parseSessionCookie(cookie);
  if (!session) throw unauthorized();

  const row = db
    .select({ id: users.id, username: users.username, role: users.role, disabled: users.disabled })
    .from(users)
    .where(eq(users.id, session.uid))
    .get();
  if (!row || row.disabled) throw unauthorized();
  return { id: row.id, username: row.username, role: row.role };
}

/** Same as requireSession, but rejects anyone below `min` with a 403. */
export async function requireRole(min: Role): Promise<AuthedUser> {
  const user = await requireSession();
  if (!atLeast(user.role, min)) {
    const err = new Error(`requires ${min} role or higher`) as Error & { status: number };
    err.status = 403;
    throw err;
  }
  return user;
}

export async function trySession(): Promise<AuthedUser | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}
