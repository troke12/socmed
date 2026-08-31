import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { posts, postMedia, accounts } from "@db/schema";
import { requireSession } from "@/lib/auth/require";
import { CreatePostBody } from "@/lib/validators/post";
import { UpdatePostBody } from "@/lib/validators/post";
import { enqueue } from "@/lib/queue/enqueue";

export const runtime = "nodejs";

// Dispatch helper: reads body, branches on `action` field.
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
      id: posts.id,
      accountId: posts.accountId,
      accountHandle: accounts.handle,
      platform: accounts.platform,
      kind: posts.kind,
      status: posts.status,
      caption: posts.caption,
      hashtags: posts.hashtags,
      linkUrl: posts.linkUrl,
      scheduledFor: posts.scheduledFor,
      publishedAt: posts.publishedAt,
      platformPostUrl: posts.platformPostUrl,
      error: posts.error,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .leftJoin(accounts, eq(posts.accountId, accounts.id))
    .orderBy(desc(posts.createdAt))
    .all();
  return NextResponse.json({ posts: rows });
}

export async function POST(req: Request) {
  try { await requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  await runMigrations();
  const raw = (await readJson(req)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const action = (raw as { action?: string }).action;

  // --- create ---
  if (action === undefined || action === "create") {
    const parsed = CreatePostBody.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { accountId, kind, caption, hashtags, linkUrl, mediaIds, scheduledFor } = parsed.data;
    const account = db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account) return NextResponse.json({ error: "account not found" }, { status: 404 });

    const now = Math.floor(Date.now() / 1000);
    const status = scheduledFor && scheduledFor > now ? "scheduled" : "draft";

    const created = db
      .insert(posts)
      .values({
        accountId,
        kind,
        status,
        caption,
        hashtags,
        linkUrl: linkUrl ?? null,
        scheduledFor: status === "scheduled" ? scheduledFor : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: posts.id })
      .get();

    if (!created) return NextResponse.json({ error: "failed to create post" }, { status: 500 });

    for (let i = 0; i < mediaIds.length; i++) {
      const mediaId = mediaIds[i]!;
      db.insert(postMedia).values({ postId: created.id, mediaId, position: i }).run();
    }

    if (status === "scheduled" && scheduledFor) {
      enqueue("publish_post", { postId: created.id }, { runAt: scheduledFor });
    }

    return NextResponse.json({ id: created.id, status }, { status: 201 });
  }

  // --- update ---
  if (action === "update") {
    const Body = UpdatePostBody.extend({ id: z.number().int().positive() });
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const id = parsed.data.id;
    const existing = db.select().from(posts).where(eq(posts.id, id)).get();
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (existing.status === "published") {
      return NextResponse.json({ error: "cannot edit published post" }, { status: 409 });
    }
    const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
    if (parsed.data.caption !== undefined) updates.caption = parsed.data.caption;
    if (parsed.data.hashtags !== undefined) updates.hashtags = parsed.data.hashtags;
    if (parsed.data.linkUrl !== undefined) updates.linkUrl = parsed.data.linkUrl;
    if (parsed.data.kind !== undefined) updates.kind = parsed.data.kind;
    if (parsed.data.mediaIds !== undefined) {
      db.delete(postMedia).where(eq(postMedia.postId, id)).run();
      for (let i = 0; i < parsed.data.mediaIds.length; i++) {
        const mediaId = parsed.data.mediaIds[i]!;
        db.insert(postMedia).values({ postId: id, mediaId, position: i }).run();
      }
    }
    if (parsed.data.scheduledFor !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      const sched = parsed.data.scheduledFor;
      if (sched && sched > now) {
        updates.scheduledFor = sched;
        updates.status = "scheduled";
        enqueue("publish_post", { postId: id }, { runAt: sched });
      } else {
        updates.scheduledFor = null;
        updates.status = "draft";
      }
    }
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    db.update(posts).set(updates).where(eq(posts.id, id)).run();
    return NextResponse.json({ ok: true });
  }

  // --- publish_now ---
  if (action === "publish_now") {
    const Body = z.object({ id: z.number().int().positive() });
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const id = parsed.data.id;
    const post = db.select().from(posts).where(eq(posts.id, id)).get();
    if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (post.status === "published") {
      return NextResponse.json({ error: "already published" }, { status: 409 });
    }
    db.update(posts)
      .set({
        status: "scheduled",
        scheduledFor: Math.floor(Date.now() / 1000),
        error: null,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(posts.id, id))
      .run();
    enqueue("publish_post", { postId: id });
    return NextResponse.json({ ok: true, queued: true });
  }

  // --- delete ---
  if (action === "delete") {
    const Body = z.object({ id: z.number().int().positive() });
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const existing = db.select({ id: posts.id }).from(posts).where(eq(posts.id, parsed.data.id)).get();
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    db.delete(posts).where(eq(posts.id, parsed.data.id)).run();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}
