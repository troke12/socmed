import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "web",
    version: "0.1.0",
    time: Math.floor(Date.now() / 1000),
  });
}
