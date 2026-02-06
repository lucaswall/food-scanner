import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "./index";
import { logger } from "@/lib/logger";

export async function runMigrations(): Promise<void> {
  logger.info({ action: "migrations_start" }, "running database migrations");
  try {
    await migrate(getDb(), { migrationsFolder: "./drizzle" });
    logger.info({ action: "migrations_success" }, "database migrations completed");
  } catch (error) {
    logger.error(
      { action: "migrations_failed", error: error instanceof Error ? error.message : String(error) },
      "database migrations failed",
    );
    throw error;
  }
}
