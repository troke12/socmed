import { NextResponse } from "next/server";

/**
 * Maps an auth error to its response. requireRole throws 403 while
 * requireSession throws 401, and every route needs to preserve that difference
 * — a viewer hitting a write route is authenticated, just not allowed.
 */
export function authErrorResponse(e: unknown): NextResponse {
  const status = (e as { status?: number }).status ?? 401;
  return NextResponse.json({ error: (e as Error).message }, { status });
}
