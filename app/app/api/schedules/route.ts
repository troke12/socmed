import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { scheduleRules, accounts, posts } from "@db/schema";
import { requireSession } from "@/lib/auth/require";
import { requireActor } from "@/lib/auth/authenticate";
import { authErrorResponse } from "@/lib/auth/http";
import { CreateScheduleBody, UpdateScheduleBody } from "@/lib/validators/schedule";
import { nextCronRun } from "@/lib/schedule/cron";
import { enqueue } from "@/lib/queue/enqueue";

export const runtime = "nodejs";

async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

export async function GET() {
  try { await requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  await runMigrations();
  const rows = db
    .select({
      id: scheduleRules.id,
      accountId: scheduleRules.accountId,
      accountLabel: accounts.label,
      accountHandle: accounts.handle,
      platform: accounts.platform,
      name: scheduleRules.name,
      cronExpr: scheduleRules.cronExpr,
      timezone: scheduleRules.timezone,
      templatePostId: scheduleRules.templatePostId,
      templateCaption: posts.caption,
      enabled: scheduleRules.enabled,
      nextRunAt: scheduleRules.nextRunAt,
      lastRunAt: scheduleRules.lastRunAt,
      createdAt: scheduleRules.createdAt,
    })
    .from(scheduleRules)
    .leftJoin(accounts, eq(scheduleRules.accountId, accounts.id))
    .leftJoin(posts, eq(scheduleRules.templatePostId, posts.id))
    .orderBy(desc(scheduleRules.createdAt))
    .all();
  return NextResponse.json({ rules: rows });
}

export async function POST(req: Request) {
  try { await requireActor(req, "editor"); } catch (e) { return authErrorResponse(e); }
  await runMigrations();
  const raw = (await readJson(req)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const action = (raw as { action?: string }).action;

  // --- create ---
  if (action === undefined || action === "create") {
    const parsed = CreateScheduleBody.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { accountId, name, cronExpr, timezone, templatePostId, enabled } = parsed.data;
    const account = db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });
    if (templatePostId) {
      const tpl = db.select({ id: posts.id }).from(posts).where(eq(posts.id, templatePostId)).get();
      if (!tpl) return NextResponse.json({ error: "template post not found" }, { status: 404 });
    }

    const now = Math.floor(Date.now() / 1000);
    const created = db
      .insert(scheduleRules)
      .values({
        accountId,
        name,
        cronExpr,
        timezone,
        templatePostId: templatePostId ?? null,
        enabled: enabled ? 1 : 0,
        nextRunAt: nextCronRun(cronExpr, timezone, now),
        createdAt: now,
      })
      .returning({ id: scheduleRules.id })
      .get();
    if (!created) return NextResponse.json({ error: "failed to create rule" }, { status: 500 });
    return NextResponse.json({ id: created.id }, { status: 201 });
  }

  // --- update ---
  if (action === "update") {
    const parsed = UpdateScheduleBody.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { id } = parsed.data;
    const existing = db.select().from(scheduleRules).where(eq(scheduleRules.id, id)).get();
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.accountId !== undefined) updates.accountId = parsed.data.accountId;
    if (parsed.data.templatePostId !== undefined) updates.templatePostId = parsed.data.templatePostId ?? null;
    if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled ? 1 : 0;

    const cronExpr = parsed.data.cronExpr ?? existing.cronExpr;
    const timezone = parsed.data.timezone ?? existing.timezone;
    if (parsed.data.cronExpr !== undefined) updates.cronExpr = cronExpr;
    if (parsed.data.timezone !== undefined) updates.timezone = timezone;

    // Recompute the next fire time whenever the schedule changes, and also when a
    // rule is re-enabled: a rule disabled for a week has a next_run_at deep in the
    // past and would otherwise fire the instant it came back on.
    const scheduleChanged = parsed.data.cronExpr !== undefined || parsed.data.timezone !== undefined;
    const reEnabled = parsed.data.enabled === true && existing.enabled === 0;
    if (scheduleChanged || reEnabled) {
      updates.nextRunAt = nextCronRun(cronExpr, timezone, Math.floor(Date.now() / 1000));
    }

    db.update(scheduleRules).set(updates).where(eq(scheduleRules.id, id)).run();
    return NextResponse.json({ ok: true });
  }

  // --- run_now ---
  if (action === "run_now") {
    const Body = z.object({ id: z.number().int().positive() });
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const existing = db.select({ id: scheduleRules.id }).from(scheduleRules).where(eq(scheduleRules.id, parsed.data.id)).get();
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    enqueue("schedule_rule", { ruleId: parsed.data.id });
    return NextResponse.json({ ok: true, queued: true });
  }

  // --- delete ---
  if (action === "delete") {
    const Body = z.object({ id: z.number().int().positive() });
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const existing = db.select({ id: scheduleRules.id }).from(scheduleRules).where(eq(scheduleRules.id, parsed.data.id)).get();
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    db.delete(scheduleRules).where(eq(scheduleRules.id, parsed.data.id)).run();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}
