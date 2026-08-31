import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE } from "./session";

// Shared cookie-setting helper: httpOnly, SameSite=Lax, Secure whenever the
// app is served behind TLS (NODE_ENV=production) or explicitly requested.
export function applySessionCookie(res: NextResponse, value: string): void {
  const secure = process.env.NODE_ENV === "production" || process.env.SOCMED_COOKIE_SECURE === "true";
  res.cookies.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
}
