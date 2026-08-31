import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dbPath = process.env.SOCMED_DB_PATH ?? "./data/app.db";

mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);

function safePragma(p: string): void {
  // next build imports route modules in parallel workers, all opening
  // this file. WAL pragma writes the DB header, which can throw
  // SQLITE_BUSY if another process is mid-write. Retry a few times.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      sqlite.pragma(p);
      return;
    } catch (err) {
      if (attempt === 4) throw err;
      const waitMs = 100 * (attempt + 1);
      // eslint-disable-next-line no-console
      console.warn(`[db] pragma ${p} busy, retrying in ${waitMs}ms...`);
      const now = Date.now();
      while (Date.now() - now < waitMs) {
        // busy-wait (sync context; better-sqlite3 is sync)
        const u = new Uint32Array(1);
        crypto.getRandomValues(u);
      }
    }
  }
}

// Set busy_timeout FIRST so WAL mode change retries instead of throwing
// SQLITE_BUSY immediately.
safePragma("busy_timeout = 5000");
safePragma("journal_mode = WAL");
safePragma("synchronous = NORMAL");
safePragma("foreign_keys = ON");

export const db = drizzle(sqlite);
export { sqlite };
