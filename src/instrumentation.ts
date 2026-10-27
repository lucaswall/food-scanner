import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry-scrub";

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
      // Browser envelopes relayed by the /monitoring tunnel route aren't app traffic
      ignoreSpans: [/^POST \/monitoring$/],
      enableLogs: true,
      sendDefaultPii: false,
      // Never ship session cookies, Authorization/API-key headers or request bodies.
      beforeSend: scrubSentryEvent,
      beforeSendTransaction: scrubSentryEvent,
      integrations: [
        Sentry.requestDataIntegration({ include: { cookies: false, data: false } }),
        Sentry.pinoIntegration({
          log: { levels: ["warn", "error", "fatal"] },
          error: { levels: ["error", "fatal"] },
        }),
      ],
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 1.0,
      sendDefaultPii: false,
      beforeSend: scrubSentryEvent,
      beforeSendTransaction: scrubSentryEvent,
    });
  }

  const { validateRequiredEnvVars, validateHealthDryRunEnv, validateTestAuthEnv } = await import("@/lib/env");
  validateRequiredEnvVars();
  validateHealthDryRunEnv();
  validateTestAuthEnv();

  // Fail fast if the health-token encryption key is malformed (must decode to 32 bytes).
  // Gated to the Node.js runtime: token-encryption imports node:crypto, which must not be
  // bundled into the Edge instrumentation. NEXT_RUNTIME is replaced per-bundle, so this
  // branch (and the dynamic import) is dead-code-eliminated from the Edge build. Token
  // encryption only ever runs server-side, so there's nothing to validate on Edge.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEncryptionKey } = await import("@/lib/token-encryption");
    validateEncryptionKey();
  }

  const { logger } = await import("@/lib/logger");
  const proc = globalThis.process;
  logger.info(
    {
      action: "server_start",
      nodeVersion: proc.version,
      nodeEnv: proc.env.NODE_ENV,
      logLevel: proc.env.LOG_LEVEL || (proc.env.NODE_ENV === "production" ? "info" : "debug"),
      healthDryRun: proc.env.HEALTH_DRY_RUN === "true",
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

  // No custom SIGTERM/SIGINT handlers: `next start` already stops accepting connections,
  // drains in-flight requests and then exits (code 143). Ending the DB pool or forcing an
  // exit here would race that drain and break requests still writing to the database.
}

export const onRequestError = Sentry.captureRequestError;
