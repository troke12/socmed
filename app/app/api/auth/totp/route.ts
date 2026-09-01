import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { users } from "@db/schema";
import { requireSession, requireRole } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { verifyPassword } from "@/lib/auth/password";
import { encryptJsonScoped, decryptJsonScoped, pack, unpack } from "@platforms/crypto";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/auth/totp";

export const runtime = "nodejs";

const SCOPE = "socmed-user-totp";

function storeSecret(userId: number, secret: string): void {
  const ct = encryptJsonScoped(SCOPE, userId, { secret });
  const packed = pack(ct);
  db.update(users)
    .set({
      totpSecret: packed.encryptedCreds,
      totpIv: packed.credsIv,
      totpTag: packed.credsTag,
      totpEnabled: 0,
      totpLastStep: null,
    })
    .where(eq(users.id, userId))
    .run();
}

function loadSecret(row: { id: number; totpSecret: Buffer | null; totpIv: Buffer | null; totpTag: Buffer | null }): string | null {
  if (!row.totpSecret || !row.totpIv || !row.totpTag) return null;
  try {
    return decryptJsonScoped<{ secret: string }>(SCOPE, row.id, unpack(row.totpSecret, row.totpIv, row.totpTag)).secret;
  } catch {
    return null;
  }
}

export async function GET() {
  let actor;
  try { actor = await requireSession(); } catch (e) { return authErrorResponse(e); }
  await runMigrations();
  const row = db.select().from(users).where(eq(users.id, actor.id)).get();
  return NextResponse.json({
    enabled: Boolean(row?.totpEnabled),
    // An unconfirmed secret means enrolment was started and abandoned.
    pending: Boolean(row && !row.totpEnabled && row.totpSecret),
  });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireSession(); } catch (e) { return authErrorResponse(e); }
  await runMigrations();

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const action = (raw as { action?: string }).action;

  if (action === "begin") {
    const row = db.select().from(users).where(eq(users.id, actor.id)).get();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (row.totpEnabled) {
      // Re-enrolling silently would invalidate the authenticator they are
      // currently relying on; make them disable it first, with their password.
      return NextResponse.json({ error: "two-factor is already enabled — disable it first" }, { status: 409 });
    }
    const secret = generateTotpSecret();
    storeSecret(actor.id, secret);
    return NextResponse.json({
      secret,
      uri: otpauthUri(secret, actor.username),
    });
  }

  if (action === "confirm") {
    const parsed = z.object({ code: z.string().min(6).max(10) }).safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const row = db.select().from(users).where(eq(users.id, actor.id)).get();
    const secret = row ? loadSecret(row) : null;
    if (!row || !secret) {
      return NextResponse.json({ error: "start setup first" }, { status: 409 });
    }
    const result = verifyTotp(secret, parsed.data.code, { lastUsedStep: row.totpLastStep });
    if (!result.ok) return NextResponse.json({ error: "that code did not match" }, { status: 400 });
    db.update(users).set({ totpEnabled: 1, totpLastStep: result.step }).where(eq(users.id, row.id)).run();
    return NextResponse.json({ ok: true });
  }

  if (action === "disable") {
    // Re-authenticate: a borrowed unlocked session should not be able to strip
    // the second factor off the account.
    const parsed = z.object({ password: z.string().min(1).max(256) }).safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "password required" }, { status: 400 });
    const row = db.select().from(users).where(eq(users.id, actor.id)).get();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!(await verifyPassword(parsed.data.password, row.passwordHash))) {
      return NextResponse.json({ error: "incorrect password" }, { status: 401 });
    }
    db.update(users)
      .set({ totpSecret: null, totpIv: null, totpTag: null, totpEnabled: 0, totpLastStep: null })
      .where(eq(users.id, row.id))
      .run();
    return NextResponse.json({ ok: true });
  }

  if (action === "admin_reset") {
    // Recovery path for a user who lost their device. There are no backup
    // codes, so an admin clearing the enrolment is the only way back in.
    let admin;
    try { admin = await requireRole("admin"); } catch (e) { return authErrorResponse(e); }
    const parsed = z.object({ id: z.number().int().positive() }).safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const target = db.select({ id: users.id }).from(users).where(eq(users.id, parsed.data.id)).get();
    if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
    db.update(users)
      .set({ totpSecret: null, totpIv: null, totpTag: null, totpEnabled: 0, totpLastStep: null })
      .where(eq(users.id, target.id))
      .run();
    return NextResponse.json({ ok: true, resetBy: admin.username });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}
