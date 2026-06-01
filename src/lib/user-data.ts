import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import {
  users,
  sessions,
  healthTokens,
  customFoods,
  foodLogEntries,
  apiKeys,
  claudeUsage,
  nutritionLabels,
  dailyCalorieGoals,
  glucoseReadings,
  savedAnalyses,
  bloodPressureReadings,
  hydrationReadings,
} from "@/db/schema";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

/**
 * Permanently delete ALL data for the given userId across every table in the
 * schema. The entire deletion is wrapped in a single Postgres transaction —
 * if any step fails, the whole operation rolls back and the user's data is
 * left intact.
 *
 * Deletion order is children-before-parents in FK-safe order:
 *   1. food_log_entries  — references both custom_foods AND users
 *   2. custom_foods      — references users
 *   3. sessions          — references users
 *   4. health_tokens     — references users
 *   5. api_keys          — references users
 *   6. claude_usage      — references users
 *   7. nutrition_labels  — references users
 *   8. daily_calorie_goals — references users
 *   9. glucose_readings  — references users
 *  10. saved_analyses    — references users
 *  11. blood_pressure_readings — references users
 *  12. hydration_readings — references users
 *  13. users             — deleted last (all FK children already gone)
 *
 * FK strategy: ON DELETE NO ACTION (not CASCADE). Rationale:
 * - Fail-safe: accidental single-table deletes are caught by the DB rather
 *   than silently cascading, making missed tables immediately visible.
 * - Self-documenting: the explicit order here is reviewable code; CASCADE
 *   hides what gets deleted and the rationale for the sequence.
 * - No schema change required: NO ACTION is the Drizzle ORM default; CASCADE
 *   would require `{ onDelete: "cascade" }` on every FK plus a migration.
 * The CASCADE alternative is noted in MIGRATIONS.md as a future option should
 * the number of tables grow to the point where this function becomes hard to
 * maintain.
 */
export async function deleteUserData(userId: string, log?: Logger): Promise<void> {
  const l = log ?? logger;
  const db = getDb();

  await db.transaction(async (tx) => {
    // 1. food_log_entries — has FK to both custom_foods AND users; must be
    //    first so both those FKs are satisfied before their parents are deleted.
    await tx.delete(foodLogEntries).where(eq(foodLogEntries.userId, userId));

    // 2. custom_foods — references users; safe now that food_log_entries gone.
    await tx.delete(customFoods).where(eq(customFoods.userId, userId));

    // 3–12. Remaining leaf tables (each references only users).
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(healthTokens).where(eq(healthTokens.userId, userId));
    await tx.delete(apiKeys).where(eq(apiKeys.userId, userId));
    await tx.delete(claudeUsage).where(eq(claudeUsage.userId, userId));
    await tx.delete(nutritionLabels).where(eq(nutritionLabels.userId, userId));
    await tx.delete(dailyCalorieGoals).where(eq(dailyCalorieGoals.userId, userId));
    await tx.delete(glucoseReadings).where(eq(glucoseReadings.userId, userId));
    await tx.delete(savedAnalyses).where(eq(savedAnalyses.userId, userId));
    await tx.delete(bloodPressureReadings).where(eq(bloodPressureReadings.userId, userId));
    await tx.delete(hydrationReadings).where(eq(hydrationReadings.userId, userId));

    // 13. Delete the user row itself — all FK children are gone so this succeeds.
    await tx.delete(users).where(eq(users.id, userId));
  });

  l.info({ action: "delete_user_data", userId }, "all user data deleted");
}
