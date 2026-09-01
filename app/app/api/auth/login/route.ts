import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { users } from "@db/schema";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSessionCookie,
  createPendingTotpCookie,
  parsePendingTotpCookie,
  PENDING_TOTP_COOKIE_NAME,
} from "@/lib/auth/session";
import {
  applySessionCookie,
  applyPendingTotpCookie,
  clearPendingTotpCookie,
} from "@/lib/auth/cookie";
import { ensureSeedUser } from "@/lib/auth/seed";
import { loginAllowed } from "@/lib/security/rate-limit";
import { verifyTotp } from "@/lib/auth/totp";
import { decryptJsonScoped } from "@platforms/crypto";
import { unpack } from "@platforms/crypto";

export const runtime = "nodejs";

const Body = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

// Second leg: the password was already verified, and the short-lived pending
// cookie stands in for it.
const TotpBody = z.object({
  totp: z.string().min(6).max(10),
});

function readTotpSecret(row: {
  id: number;
  totpSecret: Buffer | null;
  totpIv: Buffer | null;
  totpTag: Buffer | null;
}): string | null {
  if (!row.totpSecret || !row.totpIv || !row.totpTag) return null;
  try {
    const { secret } = decryptJsonScoped<{ secret: string }>(
      "socmed-user-totp",
      row.id,
      unpack(row.totpSecret, row.totpIv, row.totpTag),
    );
    return secret;
  } catch {
    return null;
  }
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  await runMigrations();
  await ensureSeedUser();

  const json = await req.json().catch(() => null);
  const ip = clientIp(req);

  // --- second leg: code only, authorised by the pending cookie ---
  const totpParsed = TotpBody.safeParse(json);
  if (totpParsed.success) {
    if (!loginAllowed(ip)) {
      return NextResponse.json({ error: "too many attempts — try again later" }, { status: 429 });
    }
    const pending = parsePendingTotpCookie(req.cookies.get(PENDING_TOTP_COOKIE_NAME)?.value);
    if (!pending) {
      return NextResponse.json({ error: "session expired — sign in again" }, { status: 401 });
    }
    const user = db.select().from(users).where(eq(users.id, pending.uid)).get();
    if (!user || user.disabled || !user.totpEnabled) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }
    const secret = readTotpSecret(user);
    if (!secret) {
      return NextResponse.json({ error: "two-factor is misconfigured — ask an admin to reset it" }, { status: 500 });
    }
    const result = verifyTotp(secret, totpParsed.data.totp, { lastUsedStep: user.totpLastStep });
    if (!result.ok) {
      return NextResponse.json({ error: "invalid code" }, { status: 401 });
    }
    // Burn the step so the same code cannot be replayed inside its window.
    db.update(users).set({ totpLastStep: result.step }).where(eq(users.id, user.id)).run();

    const res = NextResponse.json({ ok: true, uid: user.id });
    applySessionCookie(res, createSessionCookie(user.id));
    clearPendingTotpCookie(res);
    return res;
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { username, password } = parsed.data;
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

  if (row.disabled) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  if (row.totpEnabled) {
    // No session cookie yet — only a short-lived token saying the password
    // checked out. It is signed under a different domain than a session, so it
    // cannot be replayed as one.
    const res = NextResponse.json({ needsTotp: true });
    applyPendingTotpCookie(res, createPendingTotpCookie(row.id));
    return res;
  }

  const cookie = createSessionCookie(row.id);
  const res = NextResponse.json({ ok: true, uid: row.id });
  applySessionCookie(res, cookie);
  return res;
}
