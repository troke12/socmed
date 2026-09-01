import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateToken, hashToken, bearerToken, TOKEN_PREFIX } from "@/lib/auth/api-token";

// Cookie auth is stubbed as absent so these tests exercise the bearer path and
// the fallback boundary, not the session machinery.
let cookieUser: { id: number; username: string; role: "admin" | "editor" | "viewer" } | null = null;

vi.mock("@/lib/auth/require", () => ({
  requireSession: async () => {
    if (!cookieUser) {
      const err = new Error("unauthorized") as Error & { status: number };
      err.status = 401;
      throw err;
    }
    return cookieUser;
  },
  trySession: async () => cookieUser,
  requireRole: async () => cookieUser,
}));

let dbDir: string;
let ORIGINAL_DB: string | undefined;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "socmed-apitoken-"));
  ORIGINAL_DB = process.env.SOCMED_DB_PATH;
  process.env.SOCMED_DB_PATH = join(dbDir, "test.db");
  const { sqlite } = await import("@db/client");
  sqlite.exec("PRAGMA journal_mode = WAL");
  const { runMigrations } = await import("@db/migrate");
  await runMigrations();
}, 120_000);

afterAll(() => {
  if (ORIGINAL_DB !== undefined) process.env.SOCMED_DB_PATH = ORIGINAL_DB;
  try {
    rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows can hold SQLite file locks briefly — best-effort cleanup.
  }
});

async function insertToken(opts: {
  role: "editor" | "viewer";
  expiresAt?: number | null;
  revokedAt?: number | null;
}): Promise<string> {
  const { sqlite } = await import("@db/client");
  const issued = generateToken();
  sqlite
    .prepare(
      `INSERT INTO api_tokens (name, token_hash, prefix, role, expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `t-${Math.random()}`,
      issued.tokenHash,
      issued.prefix,
      opts.role,
      opts.expiresAt ?? null,
      opts.revokedAt ?? null,
      Math.floor(Date.now() / 1000),
    );
  return issued.secret;
}

function req(token?: string): Request {
  return new Request("http://localhost/api/posts", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("token generation", () => {
  it("is prefixed and high-entropy", () => {
    const t = generateToken();
    expect(t.secret.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(t.secret.length).toBeGreaterThan(40);
    expect(t.prefix.length).toBeLessThan(t.secret.length);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateToken().secret));
    expect(seen.size).toBe(200);
  });

  it("stores only a hash of the secret", () => {
    const t = generateToken();
    expect(t.tokenHash).toBe(hashToken(t.secret));
    // A leaked database must not yield usable tokens.
    expect(t.tokenHash).not.toContain(t.secret);
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("bearerToken", () => {
  it("reads a bearer header case-insensitively", () => {
    expect(bearerToken(new Request("http://x/", { headers: { authorization: "Bearer abc" } }))).toBe("abc");
    expect(bearerToken(new Request("http://x/", { headers: { authorization: "bearer abc" } }))).toBe("abc");
  });

  it("ignores other schemes and empty values", () => {
    expect(bearerToken(new Request("http://x/", { headers: { authorization: "Basic abc" } }))).toBeNull();
    expect(bearerToken(new Request("http://x/", { headers: { authorization: "Bearer " } }))).toBeNull();
    expect(bearerToken(new Request("http://x/"))).toBeNull();
  });
});

describe("authenticateApiToken", () => {
  it("resolves a valid token", async () => {
    const { authenticateApiToken } = await import("@/lib/auth/api-token");
    const secret = await insertToken({ role: "editor" });
    expect(authenticateApiToken(req(secret))?.role).toBe("editor");
  });

  it("records last use", async () => {
    const { authenticateApiToken } = await import("@/lib/auth/api-token");
    const { sqlite } = await import("@db/client");
    const secret = await insertToken({ role: "viewer" });
    const actor = authenticateApiToken(req(secret))!;
    const row = sqlite.prepare(`SELECT last_used_at FROM api_tokens WHERE id = ?`).get(actor.tokenId) as {
      last_used_at: number | null;
    };
    expect(row.last_used_at).not.toBeNull();
  });

  it("refuses a revoked, expired or unknown token identically", async () => {
    const { authenticateApiToken } = await import("@/lib/auth/api-token");
    const now = Math.floor(Date.now() / 1000);
    const revoked = await insertToken({ role: "editor", revokedAt: now - 10 });
    const expired = await insertToken({ role: "editor", expiresAt: now - 10 });
    // All three return null, so a caller cannot learn which tokens exist.
    expect(authenticateApiToken(req(revoked))).toBeNull();
    expect(authenticateApiToken(req(expired))).toBeNull();
    expect(authenticateApiToken(req("socmed_nonsense"))).toBeNull();
  });

  it("accepts a token that has not expired yet", async () => {
    const { authenticateApiToken } = await import("@/lib/auth/api-token");
    const secret = await insertToken({ role: "editor", expiresAt: Math.floor(Date.now() / 1000) + 3600 });
    expect(authenticateApiToken(req(secret))).not.toBeNull();
  });
});

describe("requireActor", () => {
  it("enforces the minimum role on a token", async () => {
    const { requireActor } = await import("@/lib/auth/authenticate");
    const viewer = await insertToken({ role: "viewer" });
    await expect(requireActor(req(viewer), "editor")).rejects.toMatchObject({ status: 403 });
    await expect(requireActor(req(viewer), "viewer")).resolves.toMatchObject({ kind: "api_token" });
  });

  it("prefers the token over a session cookie", async () => {
    const { requireActor } = await import("@/lib/auth/authenticate");
    cookieUser = { id: 1, username: "admin", role: "admin" };
    const viewer = await insertToken({ role: "viewer" });
    // Otherwise a token deliberately scoped to viewer would act as an admin
    // whenever the call happened to carry a session cookie too.
    await expect(requireActor(req(viewer), "editor")).rejects.toMatchObject({ status: 403 });
    cookieUser = null;
  });

  it("falls back to the cookie when no token is present", async () => {
    const { requireActor } = await import("@/lib/auth/authenticate");
    cookieUser = { id: 1, username: "admin", role: "admin" };
    await expect(requireActor(req(), "editor")).resolves.toMatchObject({ kind: "user", username: "admin" });
    cookieUser = null;
  });

  it("rejects with 401 when neither is present", async () => {
    const { requireActor } = await import("@/lib/auth/authenticate");
    cookieUser = null;
    await expect(requireActor(req(), "viewer")).rejects.toMatchObject({ status: 401 });
  });

  it("attributes a token-driven write to no user", async () => {
    const { requireActor, actorUserId, actorLabel } = await import("@/lib/auth/authenticate");
    const secret = await insertToken({ role: "editor" });
    const actor = await requireActor(req(secret), "editor");
    // posts.author_id is a FK to users; a token has no user behind it.
    expect(actorUserId(actor)).toBeNull();
    expect(actorLabel(actor)).toMatch(/^token:/);
  });
});
