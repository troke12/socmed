import { NextResponse } from "next/server";
import { eq, and, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { users } from "@db/schema";
import { requireRole } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

const Role = z.enum(["admin", "editor", "viewer"]);
const Username = z.string().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/, "letters, digits, . _ - only");
// bcrypt silently truncates past 72 bytes, so anything longer would be a
// password the user cannot fully rely on.
const Password = z.string().min(8).max(72);

/** Number of admins that are still able to log in. */
function activeAdminCount(excludeId?: number): number {
  const rows = db
    .select({ id: users.id })
    .from(users)
    .where(
      excludeId === undefined
        ? and(eq(users.role, "admin"), eq(users.disabled, 0))
        : and(eq(users.role, "admin"), eq(users.disabled, 0), ne(users.id, excludeId)),
    )
    .all();
  return rows.length;
}

export async function GET() {
  try { await requireRole("admin"); } catch (e) { return authErrorResponse(e); }
  await runMigrations();
  const rows = db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      disabled: users.disabled,
      totpEnabled: users.totpEnabled,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.id)
    .all();
  return NextResponse.json({ users: rows });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("admin"); } catch (e) { return authErrorResponse(e); }
  await runMigrations();

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const action = (raw as { action?: string }).action;

  if (action === undefined || action === "create") {
    const parsed = z.object({ username: Username, password: Password, role: Role }).safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const existing = db.select({ id: users.id }).from(users).where(eq(users.username, parsed.data.username)).get();
    if (existing) return NextResponse.json({ error: "username already taken" }, { status: 409 });
    const created = db
      .insert(users)
      .values({
        username: parsed.data.username,
        passwordHash: await hashPassword(parsed.data.password),
        role: parsed.data.role,
        createdAt: Math.floor(Date.now() / 1000),
      })
      .returning({ id: users.id })
      .get();
    return NextResponse.json({ id: created?.id }, { status: 201 });
  }

  const Target = z.object({ id: z.number().int().positive() });

  if (action === "set_role") {
    const parsed = Target.extend({ role: Role }).safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const target = db.select().from(users).where(eq(users.id, parsed.data.id)).get();
    if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Demoting the last admin would leave nobody able to manage accounts, users
    // or roles — including undoing this very change.
    if (target.role === "admin" && parsed.data.role !== "admin" && activeAdminCount(target.id) === 0) {
      return NextResponse.json({ error: "cannot demote the last admin" }, { status: 409 });
    }
    db.update(users).set({ role: parsed.data.role }).where(eq(users.id, target.id)).run();
    return NextResponse.json({ ok: true });
  }

  if (action === "set_disabled") {
    const parsed = Target.extend({ disabled: z.boolean() }).safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const target = db.select().from(users).where(eq(users.id, parsed.data.id)).get();
    if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (parsed.data.disabled && target.id === actor.id) {
      return NextResponse.json({ error: "cannot disable yourself" }, { status: 409 });
    }
    if (parsed.data.disabled && target.role === "admin" && activeAdminCount(target.id) === 0) {
      return NextResponse.json({ error: "cannot disable the last admin" }, { status: 409 });
    }
    db.update(users).set({ disabled: parsed.data.disabled ? 1 : 0 }).where(eq(users.id, target.id)).run();
    return NextResponse.json({ ok: true });
  }

  if (action === "set_password") {
    const parsed = Target.extend({ password: Password }).safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const target = db.select({ id: users.id }).from(users).where(eq(users.id, parsed.data.id)).get();
    if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
    db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, target.id)).run();
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const parsed = Target.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const target = db.select().from(users).where(eq(users.id, parsed.data.id)).get();
    if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (target.id === actor.id) {
      return NextResponse.json({ error: "cannot delete yourself" }, { status: 409 });
    }
    if (target.role === "admin" && activeAdminCount(target.id) === 0) {
      return NextResponse.json({ error: "cannot delete the last admin" }, { status: 409 });
    }
    db.delete(users).where(eq(users.id, target.id)).run();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}
