import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment:
        process.env.NODE_ENV === "development"
          ? "development"
          : process.env.APP_URL?.includes("food-test")
            ? "staging"
            : "production",
      release: process.env.COMMIT_SHA || undefined,
      tracesSampleRate: 1.0,
      sendDefaultPii: true,
      enableLogs: true,
      integrations: [
        Sentry.pinoIntegration({
          log: { levels: ["warn", "error", "fatal"] },
        }),
        Sentry.anthropicAIIntegration(),
      ],
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 1.0,
    });
  }

  const { validateRequiredEnvVars } = await import("@/lib/env");
  validateRequiredEnvVars();

  const { logger } = await import("@/lib/logger");
  const proc = globalThis.process;
  logger.info(
    {
      action: "server_start",
      nodeVersion: proc.version,
      nodeEnv: proc.env.NODE_ENV,
      logLevel: proc.env.LOG_LEVEL || (proc.env.NODE_ENV === "production" ? "info" : "debug"),
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
        await Sentry.flush(2000);
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

export const onRequestError = Sentry.captureRequestError;
