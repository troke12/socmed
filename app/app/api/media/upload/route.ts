import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@db/client";
import { runMigrations } from "@db/migrate";
import { mediaAssets } from "@db/schema";
import { requireRole } from "@/lib/auth/require";
import { authErrorResponse } from "@/lib/auth/http";
import { storeBuffer, uploadsDir } from "@/lib/media/storage";
import { probeImage, probeVideo, generateVideoPoster } from "@/lib/media/probe";
import { join } from "node:path";

export const runtime = "nodejs";
export const maxDuration = 60;

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

// Hard cap on upload size (10MB images, 100MB videos) to bound disk/CPU use.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

export async function POST(req: Request) {
  try { await requireRole("editor"); } catch (e) { return authErrorResponse(e); }
  await runMigrations();

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  const file = form.get("file");
  const altText = (form.get("alt_text") as string | null) ?? null;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  const ext = EXT_BY_MIME[mime] ?? "";
  const kind: "image" | "video" | null = IMAGE_MIMES.has(mime)
    ? "image"
    : VIDEO_MIMES.has(mime)
      ? "video"
      : null;
  if (!kind) {
    return NextResponse.json({ error: `unsupported mime: ${mime}` }, { status: 415 });
  }
  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > maxBytes) {
    return NextResponse.json({ error: `file too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)` }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const stored = await storeBuffer(buf, ext, mime);

  // Dedupe by sha256
  const existing = db.select().from(mediaAssets).where(eq(mediaAssets.sha256, stored.sha256)).get();
  if (existing) {
    return NextResponse.json({ media: existing, deduped: true });
  }

  let width: number | null = null;
  let height: number | null = null;
  let durationMs: number | null = null;
  let posterPath: string | null = null;

  try {
    if (kind === "image") {
      const probe = await probeImage(buf);
      width = probe.width;
      height = probe.height;
    } else {
      const probe = await probeVideo(stored.absolutePath);
      width = probe.width;
      height = probe.height;
      durationMs = probe.durationMs;
      try {
        const posterAbs = join(uploadsDir(), stored.sha256.slice(0, 2), `${stored.sha256}.jpg`);
        await generateVideoPoster(stored.absolutePath, posterAbs);
        posterPath = posterAbs.replace(uploadsDir() + "/", "");
      } catch {
        // poster is best-effort
      }
    }
  } catch {
    return NextResponse.json({ error: "unable to process media file" }, { status: 422 });
  }

  const row = db
    .insert(mediaAssets)
    .values({
      path: stored.path,
      kind,
      mime,
      sizeBytes: stored.sizeBytes,
      width,
      height,
      durationMs,
      posterPath,
      altText,
      sha256: stored.sha256,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .returning()
    .get();

  return NextResponse.json({ media: row });
}
