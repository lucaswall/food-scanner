import { getDb } from "@/db/index";
import { foodLogEntries, customFoods } from "@/db/schema";
import { eq, and, gte, desc, count } from "drizzle-orm";
import { getCalorieGoalsByDateRange } from "@/lib/nutrition-goals";
import { getLumenGoalsByDate } from "@/lib/lumen";
import { getDailyNutritionSummary } from "@/lib/food-log";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

interface TopFood {
  foodName: string;
  calories: number;
  count: number;
}

async function getTopFoodsByFrequency(
  userId: string,
  currentDate: string,
): Promise<TopFood[]> {
  const db = getDb();
  const cutoff = new Date(currentDate + "T00:00:00");
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select({
      foodName: customFoods.foodName,
      calories: customFoods.calories,
      count: count(foodLogEntries.id),
    })
    .from(foodLogEntries)
    .innerJoin(customFoods, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        gte(foodLogEntries.date, cutoffDate),
      )
    )
    .groupBy(customFoods.id, customFoods.foodName, customFoods.calories)
    .orderBy(desc(count(foodLogEntries.id)))
    .limit(10);

  return rows.map((r) => ({
    foodName: r.foodName,
    calories: r.calories,
    count: r.count,
  }));
}

export async function buildUserProfile(
  userId: string,
  currentDate: string,
  log?: Logger,
): Promise<string | null> {
  const l = log ?? logger;

  const [calorieGoals, lumenGoals, nutritionSummary, topFoods] = await Promise.all([
    getCalorieGoalsByDateRange(userId, currentDate, currentDate),
    getLumenGoalsByDate(userId, currentDate),
    getDailyNutritionSummary(userId, currentDate),
    getTopFoodsByFrequency(userId, currentDate),
  ]);

  const calorieGoal = calorieGoals.length > 0 ? calorieGoals[0].calorieGoal : null;
  const hasGoals = calorieGoal !== null || lumenGoals !== null;
  const hasProgress = nutritionSummary.totals.calories > 0;
  const hasTopFoods = topFoods.length > 0;

  // Return null if user has no data at all
  if (!hasGoals && !hasProgress && !hasTopFoods) {
    l.debug({ action: "build_user_profile_empty", userId }, "no user data for profile");
    return null;
  }

  const sections: string[] = [];

  // Section 1: Goals (highest priority)
  if (calorieGoal !== null) {
    if (lumenGoals) {
      sections.push(
        `Targets ${calorieGoal} cal/day (P:${lumenGoals.proteinGoal}g C:${lumenGoals.carbsGoal}g F:${lumenGoals.fatGoal}g)`
      );
    } else {
      sections.push(`Targets ${calorieGoal} cal/day`);
    }
  }

  // Section 2: Today's progress (second priority)
  if (hasProgress) {
    const { calories, proteinG, carbsG, fatG } = nutritionSummary.totals;
    let progressStr = `Today so far: ${calories} cal`;
    if (calorieGoal !== null && calorieGoal > 0) {
      const pct = Math.round((calories / calorieGoal) * 100);
      progressStr += ` (${pct}%)`;
    }
    progressStr += `, P:${Math.round(proteinG)}g C:${Math.round(carbsG)}g F:${Math.round(fatG)}g`;
    sections.push(progressStr);
  }

  // Section 3: Top foods (third priority)
  if (hasTopFoods) {
    const foodStrs = topFoods.map(
      (f) => `${f.foodName} (×${f.count}, ${f.calories}cal)`
    );
    sections.push(`Top foods: ${foodStrs.join(", ")}`);
  }

  let profile = `User profile: ${sections.join(". ")}.`;

  // Truncate to stay under 1200 characters
  if (profile.length > 1200) {
    // Remove top foods section and rebuild
    const withoutFoods = sections.filter((s) => !s.startsWith("Top foods:"));
    profile = `User profile: ${withoutFoods.join(". ")}.`;
  }

  l.debug(
    { action: "build_user_profile_success", userId, profileLength: profile.length },
    "user profile built"
  );

  return profile;
}
