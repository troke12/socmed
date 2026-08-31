import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require";
import { sqlite } from "@db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { await requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed — cleanup handled by cancel below.
        }
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
      const timeout = setTimeout(close, 60 * 60 * 1000);
      // Cleanup when the client disconnects — no leaked intervals.
      const cancel = () => {
        clearInterval(tick);
        clearTimeout(timeout);
      };
      // ReadableStream cancel handler support
      (controller as unknown as { _cancel?: () => void })._cancel = cancel;
      stream.cancel = () => {
        cancel();
        return Promise.resolve();
      };
    },
  });
  return new NextResponse(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
