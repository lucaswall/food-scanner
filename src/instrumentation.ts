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

  const { cleanExpiredSessions } = await import("@/lib/session-db");
  const cleaned = await cleanExpiredSessions();
  if (cleaned > 0) {
    logger.info({ action: "sessions_cleaned", count: cleaned }, "cleaned expired sessions");
  }

  if (typeof globalThis.process?.on === "function") {
    let shuttingDown = false;
    const proc = globalThis.process;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ action: "server_shutdown", signal }, "graceful shutdown initiated");
      try {
        const { closeDb } = await import("@/db/index");
        await closeDb();
      } catch (error) {
        logger.debug(
          { action: "shutdown_cleanup_error", error: error instanceof Error ? error.message : String(error) },
          "best-effort cleanup failed during shutdown",
        );
      }
      setTimeout(() => {
        logger.info({ action: "server_exit" }, "server exiting");
        proc.exit(0);
      }, 5000);
    };
    proc.on("SIGTERM", () => shutdown("SIGTERM"));
    proc.on("SIGINT", () => shutdown("SIGINT"));
  }
}
