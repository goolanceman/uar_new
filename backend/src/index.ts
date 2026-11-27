import "dotenv/config";
// Boot-time environment check (skipped under NODE_ENV=test, which controls
// its own env). Throws with a readable message on misconfiguration.
import { verifyEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import { createApp } from "@/app/app";
import { startBackgroundJobs } from "@/app/bootstrap";

verifyEnv();

const PORT = Number(process.env.PORT || 4000);
const app = createApp();

app.listen(PORT, () => {
  logger.info("server_started", {
    port: PORT,
    env: process.env.NODE_ENV || "development",
    log_level: process.env.LOG_LEVEL || "info",
  });
});

startBackgroundJobs();
