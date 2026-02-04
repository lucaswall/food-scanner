export async function register() {
  const { logger } = await import("@/lib/logger");
  logger.info(
    {
      action: "server_start",
      nodeEnv: process.env.NODE_ENV,
      logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
    },
    "server started",
  );
}
