import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { uploadsDir } from "@/lib/media/storage";
import { requireSession } from "@/lib/auth/require";
import { verifyMediaSignature } from "@/lib/media/url";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "missing path" }, { status: 400 });

  // Signed URLs (used by platform APIs like Instagram/Pinterest) skip the
  // session check but are HMAC-bound to the path with an expiry.
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");
  const isSigned = exp !== null && sig !== null;
  if (isSigned) {
    const expNum = Number(exp);
    if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) {
      return NextResponse.json({ error: "expired link" }, { status: 401 });
    }
    if (!verifyMediaSignature(path, expNum, sig)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else {
    try { await requireSession(); } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 401 });
    }
  }

  const root = resolve(uploadsDir());
  const abs = resolve(root, path);
  if (abs !== root && !abs.startsWith(root + sep)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  if (!abs.startsWith(root + sep)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

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
      headers: {
        "content-type": mime,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
