import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Role } from "@/lib/auth/roles";

// The acting user is swapped per test so role enforcement can be exercised
// without minting real session cookies.
let actor: { id: number; username: string; role: Role } = { id: 0, username: "root", role: "admin" };

vi.mock("@/lib/auth/require", async () => {
  const { atLeast } = await import("@/lib/auth/roles");
  const session = async () => {
    if (actor.id === -1) {
      const err = new Error("unauthorized") as Error & { status: number };
      err.status = 401;
      throw err;
    }
    return actor;
  };
  return {
    requireSession: session,
    trySession: async () => (actor.id === -1 ? null : actor),
    requireRole: async (min: Role) => {
      const user = await session();
      if (!atLeast(user.role, min)) {
        const err = new Error(`requires ${min} role or higher`) as Error & { status: number };
        err.status = 403;
        throw err;
      }
      return user;
    },
  };
});

let dbDir: string;
let ORIGINAL_DB: string | undefined;
let rootId = 0;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "socmed-users-"));
  ORIGINAL_DB = process.env.SOCMED_DB_PATH;
  process.env.SOCMED_DB_PATH = join(dbDir, "test.db");
  process.env.SOCMED_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
  const { sqlite } = await import("@db/client");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const { runMigrations } = await import("@db/migrate");
  await runMigrations();
  await import("@/app/api/users/route");

  rootId = (sqlite
    .prepare(`INSERT INTO users (username, password_hash, role, created_at) VALUES ('root', 'x', 'admin', ?) RETURNING id`)
    .get(Math.floor(Date.now() / 1000)) as { id: number }).id;
  actor = { id: rootId, username: "root", role: "admin" };
}, 120_000);

afterAll(() => {
  if (ORIGINAL_DB !== undefined) process.env.SOCMED_DB_PATH = ORIGINAL_DB;
  try {
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows can hold SQLite file locks briefly — best-effort cleanup.
  }
});

async function call(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/users/route");
  const res = await POST(
    new Request("http://localhost/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function listUsers(): Promise<{ status: number; users?: { id: number; role: Role; disabled: number }[] }> {
  const { GET } = await import("@/app/api/users/route");
  const res = await GET();
  const j = (await res.json()) as { users?: { id: number; role: Role; disabled: number }[] };
  return { status: res.status, users: j.users };
}

describe("/api/users role enforcement", () => {
  it("refuses non-admins with 403, not 401", async () => {
    const previous = actor;
    for (const role of ["viewer", "editor"] as Role[]) {
      actor = { id: 99, username: role, role };
      // 401 would tell the client to log in again; the real answer is that this
      // signed-in user is simply not allowed.
      expect((await listUsers()).status).toBe(403);
      expect((await call({ action: "create", username: "x1", password: "password1", role: "admin" })).status).toBe(403);
    }
    actor = previous;
  });

  it("refuses an unauthenticated caller with 401", async () => {
    const previous = actor;
    actor = { id: -1, username: "", role: "viewer" };
    expect((await listUsers()).status).toBe(401);
    actor = previous;
  });
});

describe("/api/users management", () => {
  it("creates users with the requested role", async () => {
    const { status, json } = await call({ action: "create", username: "editor1", password: "password1", role: "editor" });
    expect(status).toBe(201);
    const created = (await listUsers()).users!.find((u) => u.id === json.id);
    expect(created?.role).toBe("editor");
  });

  it("rejects a duplicate username", async () => {
    await call({ action: "create", username: "dupe", password: "password1", role: "viewer" });
    const { status } = await call({ action: "create", username: "dupe", password: "password1", role: "viewer" });
    expect(status).toBe(409);
  });

  it("rejects a password bcrypt would silently truncate", async () => {
    const { status } = await call({
      action: "create",
      username: "longpass",
      password: "a".repeat(73),
      role: "viewer",
    });
    expect(status).toBe(400);
  });

  it("changes a role", async () => {
    const { json } = await call({ action: "create", username: "promoteme", password: "password1", role: "viewer" });
    const id = json.id as number;
    expect((await call({ action: "set_role", id, role: "editor" })).status).toBe(200);
    expect((await listUsers()).users!.find((u) => u.id === id)?.role).toBe("editor");
  });

  it("disables and re-enables a user", async () => {
    const { json } = await call({ action: "create", username: "toggleme", password: "password1", role: "editor" });
    const id = json.id as number;
    await call({ action: "set_disabled", id, disabled: true });
    expect((await listUsers()).users!.find((u) => u.id === id)?.disabled).toBe(1);
    await call({ action: "set_disabled", id, disabled: false });
    expect((await listUsers()).users!.find((u) => u.id === id)?.disabled).toBe(0);
  });
});

describe("lockout guards", () => {
  it("refuses to demote, disable or delete the last admin", async () => {
    // root is the only admin at this point.
    const admins = (await listUsers()).users!.filter((u) => u.role === "admin" && !u.disabled);
    expect(admins).toHaveLength(1);

    // Each of these would leave nobody able to manage users — including undoing
    // the change itself.
    expect((await call({ action: "set_role", id: rootId, role: "viewer" })).status).toBe(409);
    expect((await call({ action: "set_disabled", id: rootId, disabled: true })).status).toBe(409);
    expect((await call({ action: "delete", id: rootId })).status).toBe(409);
    expect((await listUsers()).users!.find((u) => u.id === rootId)?.role).toBe("admin");
  });

  it("allows demoting an admin once a second one exists", async () => {
    const { json } = await call({ action: "create", username: "admin2", password: "password1", role: "admin" });
    const secondId = json.id as number;
    expect((await call({ action: "set_role", id: secondId, role: "editor" })).status).toBe(200);

    // ...and the guard comes back once that second admin is gone.
    expect((await call({ action: "set_role", id: rootId, role: "editor" })).status).toBe(409);
  });

  it("does not count a disabled admin as a remaining admin", async () => {
    const { json } = await call({ action: "create", username: "admin3", password: "password1", role: "admin" });
    const thirdId = json.id as number;
    await call({ action: "set_disabled", id: thirdId, disabled: true });
    // A disabled admin cannot log in, so root is still effectively the only one.
    expect((await call({ action: "delete", id: rootId })).status).toBe(409);
  });

  it("refuses to let an admin delete or disable themselves", async () => {
    const { json } = await call({ action: "create", username: "admin4", password: "password1", role: "admin" });
    const otherAdmin = json.id as number;
    expect(otherAdmin).toBeGreaterThan(0);
    // A second active admin exists, so the last-admin guard is not what fires here.
    expect((await call({ action: "delete", id: rootId })).json.error).toContain("yourself");
    expect((await call({ action: "set_disabled", id: rootId, disabled: true })).json.error).toContain("yourself");
  });
});
