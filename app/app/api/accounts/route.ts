import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { accounts } from "@db/schema";
import { encryptJson, pack } from "@platforms/crypto";
import { CreateAccountBody } from "@/lib/validators/account";
import { requireSession } from "@/lib/auth/require";

export const runtime = "nodejs";

function unauth(e: Error): NextResponse {
  return NextResponse.json({ error: e.message || "unauthorized" }, { status: 401 });
}

export async function GET() {
  try { requireSession(); } catch (e) { return unauth(e as Error); }
  await runMigrations();
  const rows = db
    .select({
      id: accounts.id,
      platform: accounts.platform,
      label: accounts.label,
      handle: accounts.handle,
      displayName: accounts.displayName,
      instanceUrl: accounts.instanceUrl,
      status: accounts.status,
      tokenExpiresAt: accounts.tokenExpiresAt,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .orderBy(desc(accounts.createdAt))
    .all();
  return NextResponse.json({ accounts: rows });
}

export async function POST(req: Request) {
  try { requireSession(); } catch (e) { return unauth(e as Error); }
  await runMigrations();
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const action = (raw as { action?: string }).action;

  if (action === "delete") {
    const Body = z.object({ id: z.number().int().positive() });
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const existing = db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, parsed.data.id)).get();
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    db.delete(accounts).where(eq(accounts.id, parsed.data.id)).run();
    return NextResponse.json({ ok: true });
  }

  const parsed = CreateAccountBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const { platform, label, handle, displayName, creds, scopes, tokenExpiresAt, instanceUrl } = parsed.data;

  const dup = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.platform, platform), eq(accounts.label, label)))
    .get();
  if (dup) {
    return NextResponse.json(
      { error: `an account with label "${label}" already exists for ${platform}` },
      { status: 409 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const temp = db
    .insert(accounts)
    .values({
      platform,
      label,
      handle: handle ?? "",
      displayName: displayName ?? null,
      instanceUrl: instanceUrl ?? null,
      encryptedCreds: Buffer.alloc(0),
      credsIv: Buffer.alloc(0),
      credsTag: Buffer.alloc(0),
      webhookSecret: randomBytes(32).toString("base64url"),
      scopes: JSON.stringify(scopes ?? []),
      tokenExpiresAt: tokenExpiresAt ?? creds.expiresAt ?? null,
      createdAt: now,
      status: "active",
    })
    .returning({ id: accounts.id })
    .get();

  if (!temp) {
    return NextResponse.json({ error: "failed to create account" }, { status: 500 });
  }

  const ct = encryptJson(temp.id, creds);
  const packed = pack(ct);
  db.update(accounts)
    .set({
      encryptedCreds: packed.encryptedCreds,
      credsIv: packed.credsIv,
      credsTag: packed.credsTag,
    })
    .where(eq(accounts.id, temp.id))
    .run();

  return NextResponse.json({ id: temp.id, platform, label }, { status: 201 });
}
