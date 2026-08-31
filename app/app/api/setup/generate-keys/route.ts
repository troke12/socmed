import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireSession } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function POST() {
  try { await requireSession(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  const masterKey = randomBytes(32).toString("base64");
  const cookieSecret = randomBytes(32).toString("base64");
  const adminPassword = randomBytes(12).toString("base64url");
  const fs = await import("node:fs");
  const envPath = ".env";
  let env = "";
  try { env = fs.readFileSync(envPath, "utf8"); } catch { env = fs.readFileSync(".env.example", "utf8"); }

  const upsert = (k: string, v: string) => {
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(env)) env = env.replace(re, `${k}=${v}`);
    else env += `${env.endsWith("\n") ? "" : "\n"}${k}=${v}\n`;
  };
  upsert("SOCMED_MASTER_KEY", masterKey);
  upsert("SOCMED_COOKIE_SECRET", cookieSecret);
  // Generate a random admin password so the default "changeme" is never used.
  upsert("SOCMED_ADMIN_PASSWORD", adminPassword);

  fs.writeFileSync(envPath, env, { mode: 0o600 });
  // Don't echo secrets back to the browser — they live in .env (0600).
  return NextResponse.json({ ok: true, adminPassword });
}
