/**
 * daily-goals.ts — read-only accessor for daily_calorie_goals rows.
 * The full implementation (getOrComputeDailyGoals) is owned by Worker 3 (Task 7).
 * This stub exports getDailyGoalsByDate so Tasks 9, 10, 11 can import it.
 * Worker 3 will replace this file with the full implementation.
 */
import { getDb } from "@/db/index";
import { dailyCalorieGoals } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export interface DailyGoalsRow {
  calorieGoal: number | null;
  proteinGoal: number | null;
  carbsGoal: number | null;
  fatGoal: number | null;
}

/**
 * Read-only fetch of the daily_calorie_goals row for a given user + date.
 * Returns null if no row exists.
 */
export async function getDailyGoalsByDate(
  userId: string,
  date: string,
): Promise<DailyGoalsRow | null> {
  const rows = await getDb()
    .select({
      calorieGoal: dailyCalorieGoals.calorieGoal,
      proteinGoal: dailyCalorieGoals.proteinGoal,
      carbsGoal: dailyCalorieGoals.carbsGoal,
      fatGoal: dailyCalorieGoals.fatGoal,
    })
    .from(dailyCalorieGoals)
    .where(
      and(
        eq(dailyCalorieGoals.userId, userId),
        eq(dailyCalorieGoals.date, date),
      )
    );

  return rows[0] ?? null;
}
