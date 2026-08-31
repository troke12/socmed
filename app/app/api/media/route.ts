import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { uploadsDir } from "@/lib/media/storage";
import { requireSession } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try { requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "missing path" }, { status: 400 });
  // Reject path traversal
  if (path.includes("..") || path.startsWith("/")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  const abs = join(uploadsDir(), path);
  try {
    const buf = await readFile(abs);
    const ext = path.split(".").pop()?.toLowerCase();
    const mime =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "gif"
              ? "image/gif"
              : ext === "mp4"
                ? "video/mp4"
                : "application/octet-stream";
    return new NextResponse(buf, {
      headers: { "content-type": mime, "cache-control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
