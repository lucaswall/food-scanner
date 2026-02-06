export async function register() {
  const { validateRequiredEnvVars } = await import("@/lib/env");
  validateRequiredEnvVars();

  const { logger } = await import("@/lib/logger");
  logger.info(
    {
      action: "server_start",
      nodeEnv: process.env.NODE_ENV,
      logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
    },
    "server started",
  );

  const { runMigrations } = await import("@/db/migrate");
  await runMigrations();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ action: "server_shutdown", signal }, "graceful shutdown initiated");
    try {
      const { closeDb } = await import("@/db/index");
      await closeDb();
    } catch {
      // Best-effort cleanup
    }
    setTimeout(() => {
      logger.info({ action: "server_exit" }, "server exiting");
      process.exit(0);
    }, 5000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
