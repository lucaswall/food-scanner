import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, closeDb } from "@/db/index";
import { logger } from "@/lib/logger";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

export async function runMigrations(): Promise<void> {
  logger.info({ action: "migrations_start" }, "running database migrations");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await migrate(getDb(), { migrationsFolder: "./drizzle" });
      logger.info({ action: "migrations_success" }, "database migrations completed");
      return;
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        logger.error(
          { action: "migrations_failed", error: error instanceof Error ? error.message : String(error), attempt },
          "database migrations failed after all retries",
        );
        throw error;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn(
        { action: "migrations_retry", attempt, nextDelay: delay, error: error instanceof Error ? error.message : String(error) },
        `database migration attempt ${attempt} failed, retrying in ${delay}ms`,
      );

      await closeDb();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
