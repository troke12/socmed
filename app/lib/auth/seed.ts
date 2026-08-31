import { eq } from "drizzle-orm";
import { db } from "@db/client";
import { users } from "@db/schema";
import { hashPassword } from "./password";

// Seed a single admin user on first run. Credentials come from env
// so the operator can set them before the first boot.
export async function ensureSeedUser(): Promise<void> {
  const username = process.env.SOCMED_ADMIN_USERNAME ?? "admin";
  const password = process.env.SOCMED_ADMIN_PASSWORD ?? "changeme";

  const existing = db.select().from(users).where(eq(users.username, username)).get();
  if (existing) return;

  const passwordHash = await hashPassword(password);
  db.insert(users).values({
    username,
    passwordHash,
    createdAt: Math.floor(Date.now() / 1000),
  }).run();
}
