// Re-exports the Drizzle schema + client for the worker package.
// We import from the app package so there's one schema source of truth.
export { db, sqlite } from "../../app/lib/db/client";
export * as schema from "../../app/lib/db/schema";
export { runMigrations } from "../../app/lib/db/migrate";
export { enqueue } from "../../app/lib/queue/enqueue";
export { claimNext, complete, fail, queueStats } from "../../app/lib/queue/claim";
export { handleJob } from "../../app/lib/queue/handlers";
export { registerAdapter, getAdapter } from "../../app/lib/platforms/registry";
// Register all platform adapters on import
import "../../app/lib/platforms/bootstrap";
