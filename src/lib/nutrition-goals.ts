import { getDb } from "@/db/index";
import { dailyCalorieGoals } from "@/db/schema";
import { eq, and, or, between, asc, gt, isNotNull } from "drizzle-orm";

/**
 * Engine-written goal rows in [fromDate, toDate]. Invalidated rows (macro columns
 * nulled by settings/refresh invalidation, calorieGoal reset to 0) are excluded —
 * `proteinGoal IS NOT NULL` is the "engine wrote this row" sentinel (FOO-1068) —
 * so callers see a gap instead of a bogus 0 kcal goal.
 */
export async function getDailyGoalsByDateRange(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<Array<{ date: string; calorieGoal: number | null; proteinGoal: number | null; carbsGoal: number | null; fatGoal: number | null }>> {
  const rows = await getDb()
    .select({
      date: dailyCalorieGoals.date,
      calorieGoal: dailyCalorieGoals.calorieGoal,
      proteinGoal: dailyCalorieGoals.proteinGoal,
      carbsGoal: dailyCalorieGoals.carbsGoal,
      fatGoal: dailyCalorieGoals.fatGoal,
    })
    .from(dailyCalorieGoals)
    .where(
      and(
        eq(dailyCalorieGoals.userId, userId),
        between(dailyCalorieGoals.date, fromDate, toDate),
        // Skip invalidated rows (calorieGoal=0, macros null) but keep legacy
        // calorie-only rows written before the macro columns existed.
        or(isNotNull(dailyCalorieGoals.proteinGoal), gt(dailyCalorieGoals.calorieGoal, 0))
      )
    )
    .orderBy(asc(dailyCalorieGoals.date));

  return rows;
}
