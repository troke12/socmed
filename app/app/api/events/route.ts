import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require";
import { sqlite } from "@db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown): void => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("hello", { ok: true, at: Math.floor(Date.now() / 1000) });
      const tick = setInterval(() => {
        try {
          const row = sqlite
            .prepare(
              `SELECT
                (SELECT COUNT(*) FROM jobs WHERE status='pending') as pending,
                (SELECT COUNT(*) FROM jobs WHERE status='running') as running,
                (SELECT COUNT(*) FROM jobs WHERE status='done') as done,
                (SELECT COUNT(*) FROM jobs WHERE status='dead') as dead`,
            )
            .get();
          send("queue", row);
        } catch {
          // ignore
        }
      }, 5_000);
      const close = () => {
        clearInterval(tick);
        try { controller.close(); } catch { /* noop */ }
      };
      // Close after 1 hour to avoid runaway connections; client should reconnect.
      setTimeout(close, 60 * 60 * 1000);
    },
  });
  return new NextResponse(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
    },
  });
}
