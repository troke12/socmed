import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { db, sqlite } from "@db/client";
import { runMigrations } from "@db/migrate";
import { posts, postMedia, accounts, mediaAssets, users } from "@db/schema";
import { requireRole } from "@/lib/auth/require";
import { requireActor, actorUserId } from "@/lib/auth/authenticate";
import { authErrorResponse } from "@/lib/auth/http";
import { CreatePostBody } from "@/lib/validators/post";
import { UpdatePostBody } from "@/lib/validators/post";
import { enqueue, cancelPendingPublish } from "@/lib/queue/enqueue";
import { needsApproval, approvalRequired } from "@/lib/review";

export const runtime = "nodejs";

// Dispatch helper: reads body, branches on `action` field.
async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

export async function GET(req: Request) {
  try { await requireActor(req, "viewer"); } catch (e) {
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

  // ?review=pending backs the review queue; anything else lists everything.
  const reviewFilter = new URL(req.url).searchParams.get("review");
  const author = alias(users, "author");
  const reviewer = alias(users, "reviewer");
  const base = db
    .select({
      id: posts.id,
      accountId: posts.accountId,
      accountLabel: accounts.label,
      accountHandle: accounts.handle,
      platform: accounts.platform,
      kind: posts.kind,
      status: posts.status,
      caption: posts.caption,
      hashtags: posts.hashtags,
      linkUrl: posts.linkUrl,
      campaign: posts.campaign,
      firstComment: posts.firstComment,
      firstCommentPostedAt: posts.firstCommentPostedAt,
      scheduledFor: posts.scheduledFor,
      publishedAt: posts.publishedAt,
      platformPostUrl: posts.platformPostUrl,
      error: posts.error,
      reviewStatus: posts.reviewStatus,
      reviewNote: posts.reviewNote,
      reviewedAt: posts.reviewedAt,
      authorName: author.username,
      reviewerName: reviewer.username,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .leftJoin(accounts, eq(posts.accountId, accounts.id))
    .leftJoin(author, eq(posts.authorId, author.id))
    .leftJoin(reviewer, eq(posts.reviewerId, reviewer.id));
  const rows = (
    reviewFilter === "pending"
      ? base.where(eq(posts.reviewStatus, "pending"))
      : base
  )
    .orderBy(desc(posts.createdAt))
    .all();
  return NextResponse.json({ posts: rows, approvalRequired: approvalRequired() });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireActor(req, "editor"); } catch (e) { return authErrorResponse(e); }
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
    const { accountId, accountIds, kind, caption, hashtags, linkUrl, campaign, firstComment, mediaIds, scheduledFor } = parsed.data;

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
    // With approval on, an editor's post never reaches 'scheduled' directly —
    // it waits as a draft in the review queue. scheduledFor is still stored so
    // approving it can honour the time the author picked.
    const gated = needsApproval(actor.role);
    const status = !gated && scheduledFor && scheduledFor > now ? "scheduled" : "draft";
    const reviewStatus = gated && scheduledFor ? "pending" : "none";

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
              campaign: campaign ?? null,
              firstComment: firstComment ?? null,
              scheduledFor: status === "scheduled" || gated ? scheduledFor ?? null : null,
              reviewStatus,
              authorId: actorUserId(actor),
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
    return NextResponse.json({ ids, id: ids[0], status, reviewStatus }, { status: 201 });
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
    if (parsed.data.campaign !== undefined) updates.campaign = parsed.data.campaign;
    if (parsed.data.firstComment !== undefined) updates.firstComment = parsed.data.firstComment;
    if (parsed.data.kind !== undefined) updates.kind = parsed.data.kind;
    if (parsed.data.mediaIds !== undefined) {
      db.delete(postMedia).where(eq(postMedia.postId, id)).run();
      for (let i = 0; i < parsed.data.mediaIds.length; i++) {
        const mediaId = parsed.data.mediaIds[i]!;
        db.insert(postMedia).values({ postId: id, mediaId, position: i }).run();
      }
    }
    const gated = needsApproval(actor.role);
    // Changing the content after an approval invalidates it — otherwise an
    // editor could get an innocuous draft approved and then rewrite it.
    const contentChanged =
      parsed.data.caption !== undefined ||
      parsed.data.hashtags !== undefined ||
      parsed.data.linkUrl !== undefined ||
      parsed.data.mediaIds !== undefined;
    if (gated && contentChanged && existing.reviewStatus === "approved") {
      updates.reviewStatus = "pending";
      updates.reviewerId = null;
      updates.reviewedAt = null;
    }

    if (parsed.data.scheduledFor !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      const sched = parsed.data.scheduledFor;
      // Always clear the old job first. Without this, editing a scheduled post
      // twice leaves two pending publish jobs and the post goes out twice —
      // and moving a post back to draft would still publish at the old time.
      cancelPendingPublish(id);
      const approved = existing.reviewStatus === "approved" && updates.reviewStatus === undefined;
      if (sched && sched > now && (!gated || approved)) {
        updates.scheduledFor = sched;
        updates.status = "scheduled";
        enqueue("publish_post", { postId: id }, { runAt: sched });
      } else if (sched && sched > now) {
        // Gated and not approved: keep the requested time, hold it in review.
        updates.scheduledFor = sched;
        updates.status = "draft";
        updates.reviewStatus = "pending";
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
    if (needsApproval(actor.role) && post.reviewStatus !== "approved") {
      return NextResponse.json(
        { error: "this post needs approval before it can be published" },
        { status: 403 },
      );
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

  // --- submit_review ---
  if (action === "submit_review") {
    const Body = z.object({ id: z.number().int().positive() });
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const post = db.select().from(posts).where(eq(posts.id, parsed.data.id)).get();
    if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (post.status === "published") {
      return NextResponse.json({ error: "already published" }, { status: 409 });
    }
    db.update(posts)
      .set({
        reviewStatus: "pending",
        // A resubmission must not still show the previous rejection.
        reviewerId: null,
        reviewedAt: null,
        reviewNote: null,
        authorId: post.authorId ?? actorUserId(actor),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(posts.id, post.id))
      .run();
    return NextResponse.json({ ok: true });
  }

  // --- approve / reject (admin only) ---
  if (action === "approve" || action === "reject") {
    let reviewer;
    try { reviewer = await requireRole("admin"); } catch (e) { return authErrorResponse(e); }
    const Body = z.object({
      id: z.number().int().positive(),
      note: z.string().max(2000).optional(),
      publish: z.boolean().optional(),
    });
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const post = db.select().from(posts).where(eq(posts.id, parsed.data.id)).get();
    if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (post.reviewStatus !== "pending") {
      return NextResponse.json({ error: "post is not awaiting review" }, { status: 409 });
    }
    const now = Math.floor(Date.now() / 1000);

    if (action === "reject") {
      // Back into the author's hands, with the reason attached. Any queued
      // publish has to go with it.
      cancelPendingPublish(post.id);
      db.update(posts)
        .set({
          reviewStatus: "rejected",
          reviewerId: reviewer.id,
          reviewedAt: now,
          reviewNote: parsed.data.note ?? null,
          status: "draft",
          updatedAt: now,
        })
        .where(eq(posts.id, post.id))
        .run();
      return NextResponse.json({ ok: true });
    }

    // Approving applies the schedule the author asked for. A time that has
    // since passed publishes now rather than silently never firing.
    const wantsNow = parsed.data.publish === true || !post.scheduledFor || post.scheduledFor <= now;
    cancelPendingPublish(post.id);
    db.update(posts)
      .set({
        reviewStatus: "approved",
        reviewerId: reviewer.id,
        reviewedAt: now,
        reviewNote: parsed.data.note ?? null,
        status: "scheduled",
        scheduledFor: wantsNow ? now : post.scheduledFor,
        error: null,
        updatedAt: now,
      })
      .where(eq(posts.id, post.id))
      .run();
    enqueue("publish_post", { postId: post.id }, { runAt: wantsNow ? now : post.scheduledFor! });
    return NextResponse.json({ ok: true, queued: true, runAt: wantsNow ? now : post.scheduledFor });
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
