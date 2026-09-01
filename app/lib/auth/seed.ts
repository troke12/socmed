import { eq } from "drizzle-orm";
import { db } from "@db/client";
import { users } from "@db/schema";
import { hashPassword } from "./password";

// Seed the first admin on first run. Credentials come from env so the operator
// can set them before the first boot; every user after this one is created
// through /api/users by an existing admin.
export async function ensureSeedUser(): Promise<void> {
  const username = process.env.SOCMED_ADMIN_USERNAME ?? "admin";
  const password = process.env.SOCMED_ADMIN_PASSWORD ?? "changeme";

  const existing = db.select().from(users).where(eq(users.username, username)).get();
  if (existing) return;

  const passwordHash = await hashPassword(password);
  db.insert(users).values({
    username,
    passwordHash,
    role: "admin",
    createdAt: Math.floor(Date.now() / 1000),
  }).run();
}
