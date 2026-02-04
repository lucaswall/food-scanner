import { logger } from "@/lib/logger";

export function getAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) {
    logger.error({ action: "missing_app_url" }, "APP_URL environment variable is not set");
    throw new Error("APP_URL environment variable is required");
  }
  return url.replace(/\/$/, "");
}

export function buildUrl(path: string): string {
  return `${getAppUrl()}${path}`;
}
