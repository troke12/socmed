import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { users } from "@db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionCookie } from "@/lib/auth/session";
import { applySessionCookie } from "@/lib/auth/cookie";
import { ensureSeedUser } from "@/lib/auth/seed";
import { loginAllowed } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  await runMigrations();
  await ensureSeedUser();

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { username, password } = parsed.data;
  const ip = clientIp(req);
  if (!loginAllowed(ip)) {
    return NextResponse.json(
      { error: "too many attempts — try again later" },
      { status: 429 },
    );
  }

  const row = db.select().from(users).where(eq(users.username, username)).get();

  // Constant-ish time: always run a bcrypt compare even when the user
  // doesn't exist (against a fixed dummy hash) so user enumeration via
  // response timing is not possible.
  const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7XjUqK1QnY7m8dGqW9kLbQn3Yv2X0yC";
  const hashToCheck = row?.passwordHash ?? DUMMY_HASH;
  const ok = await verifyPassword(password, hashToCheck);
  if (!row || !ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const cookie = createSessionCookie(row.id);
  const res = NextResponse.json({ ok: true, uid: row.id });
  applySessionCookie(res, cookie);
  return res;
}
