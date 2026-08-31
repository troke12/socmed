import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { sqlite } from "./client";

// Resolve the migrations directory relative to cwd. Works under:
// - dev (Next.js, cwd=app)  → ./lib/db/migrations
// - worker build (cwd=/app/worker) → ../app/lib/db/migrations
// - standalone (cwd=/app, next start) → ./app/lib/db/migrations
function findMigrationsDir(): string {
  const candidates = [
    resolve(process.cwd(), "lib", "db", "migrations"),          // dev (cwd = app/)
    resolve(process.cwd(), "app", "lib", "db", "migrations"),   // standalone (cwd = /app)
    resolve(process.cwd(), "..", "app", "lib", "db", "migrations"), // worker (cwd = /app/worker)
    resolve(process.cwd(), "worker", "..", "app", "lib", "db", "migrations"),
    resolve(process.cwd(), "dist", "app", "lib", "db", "migrations"), // worker CJS build (cwd = /app/worker)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Last resort: relative to cwd itself
  return resolve(process.cwd(), "migrations");
}

const MIGRATIONS_DIR = findMigrationsDir();

export async function runMigrations(): Promise<{ applied: string[] }> {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    (sqlite.prepare("SELECT name FROM __migrations").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare("INSERT INTO __migrations (name, applied_at) VALUES (?, ?)").run(
        file,
        Math.floor(Date.now() / 1000),
      );
    });
    tx();
    newlyApplied.push(file);
  }

  return { applied: newlyApplied };
}
