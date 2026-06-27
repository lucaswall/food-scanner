import pino from "pino";
import type { DestinationStream, Logger } from "pino";
const randomUUID = () => crypto.randomUUID();

export type { Logger } from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const validLevels = new Set<string>(["debug", "info", "warn", "error", "fatal"]);
const envLevel = process.env.LOG_LEVEL;
const level: LogLevel =
  (envLevel && validLevels.has(envLevel) ? envLevel : undefined) as LogLevel ||
  (process.env.NODE_ENV === "production" ? "info" : "debug");

function createPinoOptions(
  logLevel: LogLevel = level,
): pino.LoggerOptions {
  return {
    level: logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: "message",
    // Defense-in-depth: censor secrets if any code path ever logs them. Tokens/cookies/keys
    // must never reach stdout or Sentry (CLAUDE.md). Backs up the "log keys, not bodies"
    // rule applied at the call sites (P1-12).
    redact: {
      paths: [
        "accessToken", "refreshToken", "access_token", "refresh_token",
        "client_secret", "clientSecret", "apiKey", "api_key", "password", "cookie", "authorization",
        "*.accessToken", "*.refreshToken", "*.access_token", "*.refresh_token",
        "*.client_secret", "*.clientSecret", "*.apiKey", "*.api_key", "*.password",
        "*.cookie", "*.Cookie", "*.authorization", "*.Authorization",
      ],
      censor: "[redacted]",
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };
}

function getTransport(): pino.TransportSingleOptions | undefined {
  if (process.env.NODE_ENV !== "production") {
    return {
      target: "pino-pretty",
      options: { colorize: true },
    };
  }
  return undefined;
}

const transport = getTransport();
export const logger: Logger = pino(
  createPinoOptions(),
  ...(transport ? [pino.transport(transport)] : []),
);

export function createRequestLogger(
  method: string,
  path: string,
): Logger {
  return logger.child({ requestId: randomUUID(), method, path });
}

/** Test helper: create a logger writing to a custom destination */
export function createLoggerWithDestination(
  destination: DestinationStream,
): Logger {
  return pino(createPinoOptions(), destination);
}

/** Test helper: create a request-scoped logger writing to a custom destination */
export function createRequestLoggerWithDestination(
  destination: DestinationStream,
  method: string,
  path: string,
): Logger {
  return pino(createPinoOptions(), destination).child({ requestId: randomUUID(), method, path });
}

/** Timing utility: returns a function that returns elapsed ms since creation */
export function startTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
