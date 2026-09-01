import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, sqlite } from "@db/client";
import { runMigrations } from "@db/migrate";
import { posts, postMedia, accounts, mediaAssets } from "@db/schema";
import { requireSession } from "@/lib/auth/require";
import { CreatePostBody } from "@/lib/validators/post";
import { UpdatePostBody } from "@/lib/validators/post";
import { enqueue, cancelPendingPublish } from "@/lib/queue/enqueue";

export const runtime = "nodejs";

// Dispatch helper: reads body, branches on `action` field.
async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

export async function GET(req: Request) {
  try { await requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  await runMigrations();

  // ?id=N returns a single post with its media attached, which is what Compose
  // needs to reopen a draft. The list form deliberately omits media — it feeds
  // the calendar, where per-post media would mean an N+1 query per month view.
  const idParam = new URL(req.url).searchParams.get("id");
  if (idParam !== null) {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const post = db.select().from(posts).where(eq(posts.id, id)).get();
    if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
    const media = db
      .select({
        id: mediaAssets.id,
        path: mediaAssets.path,
        kind: mediaAssets.kind,
        mime: mediaAssets.mime,
        width: mediaAssets.width,
        height: mediaAssets.height,
        position: postMedia.position,
      })
      .from(postMedia)
      .innerJoin(mediaAssets, eq(postMedia.mediaId, mediaAssets.id))
      .where(eq(postMedia.postId, id))
      .orderBy(postMedia.position)
      .all();
    return NextResponse.json({ post, media });
  }

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
    const { accountId, accountIds, kind, caption, hashtags, linkUrl, mediaIds, scheduledFor } = parsed.data;

    // One post row per target account. A parent/children model was the
    // alternative, but a flat row per account keeps every existing per-account
    // query — analytics, calendar, publish — working without a join.
    const targets = [...new Set(accountIds ?? (accountId !== undefined ? [accountId] : []))];
    const found = db
      .select({ id: accounts.id })
      .from(accounts)
      .where(inArray(accounts.id, targets))
      .all();
    if (found.length !== targets.length) {
      const missing = targets.filter((t) => !found.some((f) => f.id === t));
      return NextResponse.json({ error: `account not found: ${missing.join(", ")}` }, { status: 404 });
    }

    const now = Math.floor(Date.now() / 1000);
    const status = scheduledFor && scheduledFor > now ? "scheduled" : "draft";

    // All-or-nothing: a fan-out that fails halfway would publish to some
    // platforms and silently drop the rest, with no record of what was missed.
    let ids: number[] = [];
    try {
      ids = sqlite.transaction(() => {
        const out: number[] = [];
        for (const target of targets) {
          const created = db
            .insert(posts)
            .values({
              accountId: target,
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
          if (!created) throw new Error("failed to create post");
          for (let i = 0; i < mediaIds.length; i++) {
            db.insert(postMedia).values({ postId: created.id, mediaId: mediaIds[i]!, position: i }).run();
          }
          if (status === "scheduled" && scheduledFor) {
            enqueue("publish_post", { postId: created.id }, { runAt: scheduledFor });
          }
          out.push(created.id);
        }
        return out;
      })();
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "failed to create post" },
        { status: 500 },
      );
    }

    // `id` stays in the response for single-target callers that already read it.
    return NextResponse.json({ ids, id: ids[0], status }, { status: 201 });
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
      // Always clear the old job first. Without this, editing a scheduled post
      // twice leaves two pending publish jobs and the post goes out twice —
      // and moving a post back to draft would still publish at the old time.
      cancelPendingPublish(id);
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
    // A post being published now may still carry a pending job from an earlier
    // schedule; that one would fire again later.
    cancelPendingPublish(id);
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
