import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { getDb, closeDb } from "@/db/index";
import { logger } from "@/lib/logger";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

/**
 * Integrity guard for migration 0027 (`unit_id` integer -> text). Migration 0027
 * must convert `custom_foods.unit_id` and `food_log_entries.unit_id` to `text`
 * via a `USING (CASE …)` clause. If 0027 is journaled (migrations completed) but
 * a column is still `integer`, the conversion silently did not run — e.g. a manual
 * production override was skipped and the naive file was applied against empty
 * tables, or the journal was hand-edited. Booting in that state corrupts every
 * portion label, so we fail fast with a FATAL log instead.
 */
const UNIT_ID_TABLES = ["custom_foods", "food_log_entries"] as const;

export async function assertUnitIdConverted(
  db: NodePgDatabase<typeof schema>,
): Promise<void> {
  const result = await db.execute(sql`
    SELECT table_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'unit_id'
      AND table_name IN ('custom_foods', 'food_log_entries')
  `);
  const rows = result.rows as Array<{ table_name: string; data_type: string }>;
  const stillInteger = rows
    .filter((row) => row.data_type === "integer")
    .map((row) => row.table_name);
  if (stillInteger.length > 0) {
    logger.fatal(
      { action: "migration_guard_failed", guard: "unit_id_text", tables: stillInteger },
      "FATAL: migration 0027 applied but unit_id is still integer — refusing to boot",
    );
    throw new Error(
      `Migration 0027 integrity check failed: unit_id is still integer on ${stillInteger.join(", ")}`,
    );
  }
  // A missing column is also a corrupt post-migration state — an empty/partial result
  // must NOT pass silently (it's indistinguishable from "all text" without this check).
  if (rows.length < UNIT_ID_TABLES.length) {
    const present = new Set(rows.map((row) => row.table_name));
    const missing = UNIT_ID_TABLES.filter((t) => !present.has(t));
    logger.fatal(
      { action: "migration_guard_failed", guard: "unit_id_text", missing },
      "FATAL: unit_id column missing from expected tables — schema may be corrupt, refusing to boot",
    );
    throw new Error(
      `Migration 0027 integrity check failed: unit_id column missing on ${missing.join(", ")}`,
    );
  }
}

export async function runMigrations(): Promise<void> {
  logger.info({ action: "migrations_start" }, "running database migrations");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await migrate(getDb(), { migrationsFolder: "./drizzle" });
      break;
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

  // Post-migration integrity guard — runs once, never retried (a schema-integrity
  // failure is not transient and must fail the boot immediately).
  await assertUnitIdConverted(getDb());

  logger.info({ action: "migrations_success" }, "database migrations completed");
}
