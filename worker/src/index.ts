import { runMigrations } from "./db";
import { startScheduler, stopScheduler, getCurrentJobId } from "./scheduler";
import { startCron, stopCron } from "./cron";
import { startAnalyticsPoller, stopAnalyticsPoller } from "./pollers/analytics";
import { startMentionsPoller, stopMentionsPoller } from "./pollers/mentions";
import { startTokenPoller, stopTokenPoller } from "./pollers/tokens";
import { startAudiencePoller, stopAudiencePoller } from "./pollers/audience";

const HEALTH_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
   
  console.log(`[${new Date().toISOString()}] [worker] booting`);

  try {
    const { applied } = await runMigrations();
    if (applied.length > 0) {
       
      console.log(`[${new Date().toISOString()}] [worker] applied migrations: ${applied.join(", ")}`);
    }
  } catch (e) {
     
    console.error(`[${new Date().toISOString()}] [worker] migrations failed:`, e);
    process.exit(1);
  }

  startScheduler();
  startCron();
  startAnalyticsPoller();
  startMentionsPoller();
  startTokenPoller();
  startAudiencePoller();

  const health = setInterval(() => {
     
    console.log(
      `[${new Date().toISOString()}] [worker] health: running, currentJob=${getCurrentJobId() ?? "none"}`,
    );
  }, HEALTH_INTERVAL_MS);

  function shutdown(signal: string): void {
     
    console.log(`[${new Date().toISOString()}] [worker] received ${signal}, shutting down`);
    stopScheduler();
    stopCron();
    stopAnalyticsPoller();
    stopMentionsPoller();
    stopTokenPoller();
    stopAudiencePoller();
    clearInterval(health);
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
   
  console.error(`[${new Date().toISOString()}] [worker] fatal:`, e);
  process.exit(1);
});
