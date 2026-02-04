import pino from "pino";
import type { DestinationStream, Logger } from "pino";

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
  return logger.child({ method, path });
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
  return pino(createPinoOptions(), destination).child({ method, path });
}
