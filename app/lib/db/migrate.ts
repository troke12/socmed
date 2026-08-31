import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sqlite } from "./client";

// Resolve the migrations directory relative to this source file so it works
// regardless of cwd (dev, prod standalone, or tsx).
function findMigrationsDir(): string {
  // dev: this file is app/lib/db/migrate.ts → migrations is app/lib/db/migrations
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "migrations"),                                   // dev (source)
    resolve(here, "..", "..", "..", "app", "lib", "db", "migrations"), // standalone (built)
    resolve(process.cwd(), "app", "lib", "db", "migrations"),    // fallback: cwd = workspace root
    resolve(process.cwd(), "lib", "db", "migrations"),           // fallback: cwd = app
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]!; // last-resort; will error with a clear path
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
