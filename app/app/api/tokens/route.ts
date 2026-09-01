import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { apiTokens, users } from "@db/schema";
import { requireRole } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { generateToken } from "@/lib/auth/api-token";

export const runtime = "nodejs";

/**
 * Token management is admin-only and cookie-only. A token must never be able to
 * mint another token — that would turn a leaked viewer token into a permanent
 * foothold that survives revoking the original.
 */
export async function GET() {
  try { await requireRole("admin"); } catch (e) { return authErrorResponse(e); }
  await runMigrations();
  const rows = db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      role: apiTokens.role,
      createdByName: users.username,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .leftJoin(users, eq(apiTokens.createdBy, users.id))
    .orderBy(desc(apiTokens.createdAt))
    .all();
  return NextResponse.json({ tokens: rows });
}

export async function POST(req: Request) {
  let admin;
  try { admin = await requireRole("admin"); } catch (e) { return authErrorResponse(e); }
  await runMigrations();

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const action = (raw as { action?: string }).action;

  if (action === undefined || action === "create") {
    const parsed = z
      .object({
        name: z.string().min(1).max(120),
        role: z.enum(["editor", "viewer"]),
        expiresInDays: z.number().int().positive().max(3650).optional().nullable(),
      })
      .safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const now = Math.floor(Date.now() / 1000);
    const issued = generateToken();
    const created = db
      .insert(apiTokens)
      .values({
        name: parsed.data.name,
        tokenHash: issued.tokenHash,
        prefix: issued.prefix,
        role: parsed.data.role,
        createdBy: admin.id,
        expiresAt: parsed.data.expiresInDays ? now + parsed.data.expiresInDays * 86400 : null,
        createdAt: now,
      })
      .returning({ id: apiTokens.id })
      .get();

    // The only time the secret is ever returned. Only its hash is stored, so it
    // cannot be recovered afterwards.
    return NextResponse.json({ id: created?.id, token: issued.secret, prefix: issued.prefix }, { status: 201 });
  }

  if (action === "revoke") {
    const parsed = z.object({ id: z.number().int().positive() }).safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const row = db.select({ id: apiTokens.id, revokedAt: apiTokens.revokedAt }).from(apiTokens).where(eq(apiTokens.id, parsed.data.id)).get();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (row.revokedAt) return NextResponse.json({ ok: true, alreadyRevoked: true });
    db.update(apiTokens).set({ revokedAt: Math.floor(Date.now() / 1000) }).where(eq(apiTokens.id, row.id)).run();
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const parsed = z.object({ id: z.number().int().positive() }).safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    db.delete(apiTokens).where(eq(apiTokens.id, parsed.data.id)).run();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}
