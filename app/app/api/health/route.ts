import { NextResponse, type NextRequest } from "next/server";
import { sqlite } from "@db/client";
import { runMigrations } from "@db/migrate";
import { queueStats } from "@/lib/queue/claim";
import { rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public endpoint (used by the compose healthcheck) — rate-limit it so it
// can't be abused to thrash the DB.
export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  if (!rateLimit(`health:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  // Ensure schema exists (idempotent, cheap)
  try { await runMigrations(); } catch { /* tables may not be there yet */ }

  // Lightweight DB ping
  let dbOk = true;
  let dbErr: string | null = null;
  try {
    sqlite.prepare("SELECT 1").get();
  } catch (e) {
    dbOk = false;
    dbErr = e instanceof Error ? e.message : String(e);
  }
  let stats = { pending: 0, running: 0, done: 0, failed: 0, dead: 0 };
  if (dbOk) {
    try { stats = queueStats(); } catch { /* tables may not exist */ }
  }
  return NextResponse.json({
    ok: dbOk,
    service: "web",
    version: "0.1.0",
    time: Math.floor(Date.now() / 1000),
    db: { ok: dbOk, error: dbErr },
    queue: stats,
  });
}
