import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@db/client";
import { users } from "@db/schema";
import { parseSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = parseSessionCookie(cookie);
  if (!session) return NextResponse.json({ user: null }, { status: 200 });
  const row = db.select({ id: users.id, username: users.username }).from(users).where(eq(users.id, session.uid)).get();
  if (!row) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({ user: row });
}
