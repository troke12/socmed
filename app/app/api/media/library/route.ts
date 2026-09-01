import { NextResponse } from "next/server";
import { sqlite } from "@db/client";
import { runMigrations } from "@db/migrate";
import { requireSession } from "@/lib/auth/require";

export const runtime = "nodejs";

// Kept modest so a library built up over months still renders in one request
// without the page having to paginate on first paint.
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

export async function GET(req: Request) {
  try { await requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  await runMigrations();

  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const kind = params.get("kind");
  const limit = Math.min(Math.max(Number(params.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);

  const where: string[] = [];
  const args: (string | number)[] = [];
  if (kind === "image" || kind === "video") {
    where.push("m.kind = ?");
    args.push(kind);
  }
  if (q) {
    // Alt text is the only human-authored field; path and mime are included so a
    // filename or "png" still finds something when alt text was never filled in.
    where.push("(COALESCE(m.alt_text, '') LIKE ? OR m.path LIKE ? OR m.mime LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (
    sqlite.prepare(`SELECT COUNT(*) as n FROM media_assets m ${whereSql}`).get(...args) as { n: number }
  ).n;

  // usage_count drives the "used in N posts" badge and tells the user which
  // assets are safe to ignore. A correlated subquery beats a GROUP BY join here
  // because the page still wants unused assets (count 0) in the result.
  const rows = sqlite
    .prepare(
      `SELECT m.id, m.path, m.kind, m.mime, m.size_bytes AS sizeBytes, m.width, m.height,
              m.duration_ms AS durationMs, m.poster_path AS posterPath, m.alt_text AS altText,
              m.created_at AS createdAt,
              (SELECT COUNT(*) FROM post_media pm WHERE pm.media_id = m.id) AS usageCount
         FROM media_assets m
         ${whereSql}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset);

  return NextResponse.json({ media: rows, total, limit, offset });
}

export async function POST(req: Request) {
  try { await requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  await runMigrations();

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || raw.action !== "set_alt") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  const id = Number(raw.id);
  const altText = typeof raw.altText === "string" ? raw.altText.slice(0, 1000) : null;
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const info = sqlite.prepare(`UPDATE media_assets SET alt_text = ? WHERE id = ?`).run(altText, id);
  if (info.changes === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
