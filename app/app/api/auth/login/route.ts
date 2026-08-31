import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { users } from "@db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE, createSessionCookie } from "@/lib/auth/session";
import { ensureSeedUser } from "@/lib/auth/seed";

export const runtime = "nodejs";

const Body = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export async function POST(req: NextRequest) {
  await runMigrations();
  await ensureSeedUser();

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { username, password } = parsed.data;
  const row = db.select().from(users).where(eq(users.username, username)).get();
  if (!row) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const cookie = createSessionCookie(row.id);
  const res = NextResponse.json({ ok: true, uid: row.id });
  res.cookies.set(SESSION_COOKIE_NAME, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
