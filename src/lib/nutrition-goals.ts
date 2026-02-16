import { getDb } from "@/db/index";
import { dailyCalorieGoals } from "@/db/schema";
import { eq, and, between, asc } from "drizzle-orm";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

export async function upsertCalorieGoal(
  userId: string,
  date: string,
  calorieGoal: number,
  log?: Logger,
): Promise<void> {
  const l = log ?? logger;
  await getDb()
    .insert(dailyCalorieGoals)
    .values({
      userId,
      date,
      calorieGoal,
    })
    .onConflictDoUpdate({
      target: [dailyCalorieGoals.userId, dailyCalorieGoals.date],
      set: {
        calorieGoal,
        updatedAt: new Date(),
      },
    });

  l.info({ userId, date, calorieGoal }, "calorie goal upserted");
}

export async function getCalorieGoalsByDateRange(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<Array<{ date: string; calorieGoal: number }>> {
  const rows = await getDb()
    .select({
      date: dailyCalorieGoals.date,
      calorieGoal: dailyCalorieGoals.calorieGoal,
    })
    .from(dailyCalorieGoals)
    .where(
      and(
        eq(dailyCalorieGoals.userId, userId),
        between(dailyCalorieGoals.date, fromDate, toDate)
      )
    )
    .orderBy(asc(dailyCalorieGoals.date));

  return rows;
}
