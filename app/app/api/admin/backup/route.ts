import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { sqlite } from "@db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// WAL-safe backup via better-sqlite3's online backup API. The worker may be
// writing concurrently — this snapshot is still consistent.
async function backupDatabase(): Promise<Buffer> {
  const tmp = `${process.env.SOCMED_DB_PATH ?? "./data/app.db"}.bak-${Date.now()}`;
  // better-sqlite3's backup() is async — await it or the file won't exist yet.
  await sqlite.backup(tmp);
  const buf = readFileSync(tmp);
  rmSync(tmp, { force: true });
  return buf;
}

function tokenOk(req: NextRequest): boolean {
  const expected = process.env.SOCMED_ADMIN_TOKEN;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!tokenOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const buf = await backupDatabase();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="app-${stamp}.db"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `backup failed: ${(e as Error).message}` }, { status: 500 });
  }
}
