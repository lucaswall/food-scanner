import { getDb } from "@/db/index";
import { foodLogEntries, customFoods } from "@/db/schema";
import { eq, and, gte, desc, count } from "drizzle-orm";
import { getDailyGoalsByDate } from "@/lib/daily-goals";
import { getDailyNutritionSummary } from "@/lib/food-log";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { FITBIT_MEAL_TYPE_LABELS } from "@/types";

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

interface BuildUserProfileOptions {
  log?: Logger;
}

export async function buildUserProfile(
  userId: string,
  currentDate: string,
  options?: BuildUserProfileOptions,
): Promise<string | null> {
  const l = options?.log ?? logger;

  const [dailyGoals, nutritionSummary, topFoods] = await Promise.all([
    getDailyGoalsByDate(userId, currentDate),
    getDailyNutritionSummary(userId, currentDate),
    getTopFoodsByFrequency(userId, currentDate),
  ]);

  const calorieGoal = dailyGoals?.calorieGoal ?? null;
  const hasGoals = dailyGoals !== null;
  const hasProgress = nutritionSummary.totals.calories > 0;
  const hasMeals = nutritionSummary.meals.some((g) => g.entries.length > 0);
  const hasTopFoods = topFoods.length > 0;

  // Return null if user has no data at all
  if (!hasGoals && !hasProgress && !hasTopFoods && !hasMeals) {
    l.debug({ action: "build_user_profile_empty", userId }, "no user data for profile");
    return null;
  }

  const sections: string[] = [];

  // Section 1: Goals (highest priority)
  if (calorieGoal !== null && calorieGoal > 0) {
    if (dailyGoals?.proteinGoal != null && dailyGoals?.carbsGoal != null && dailyGoals?.fatGoal != null) {
      sections.push(
        `Targets ${calorieGoal} cal/day (P:${dailyGoals.proteinGoal}g C:${dailyGoals.carbsGoal}g F:${dailyGoals.fatGoal}g)`
      );
    } else {
      sections.push(`Targets ${calorieGoal} cal/day`);
    }
  } else if (dailyGoals !== null) {
    // Row exists but calorieGoal is null or 0 — partial state (waiting for activity)
    sections.push("Targets pending — waiting for Fitbit activity");
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

  // Section 3: Today's meals (third priority)
  if (hasMeals) {
    const mealStrs: string[] = [];
    for (const group of nutritionSummary.meals) {
      const label = FITBIT_MEAL_TYPE_LABELS[group.mealTypeId] ?? `Meal ${group.mealTypeId}`;
      for (const entry of group.entries) {
        const timePart = entry.time ? ` at ${entry.time}` : "";
        mealStrs.push(`${label}${timePart} — ${entry.foodName} (${entry.calories} cal)`);
      }
    }
    sections.push(`Today's meals: ${mealStrs.join(", ")}`);
  }

  // Section 4: Top foods (fourth priority)
  if (hasTopFoods) {
    const foodStrs = topFoods.map(
      (f) => `${f.foodName} (×${f.count}, ${f.calories}cal)`
    );
    sections.push(`Top foods: ${foodStrs.join(", ")}`);
  }

  let profile = `User profile: ${sections.join(". ")}.`;

  // Truncate to stay under 1200 characters — remove lowest priority sections first
  if (profile.length > 1200) {
    // Remove top foods section and rebuild
    const withoutFoods = sections.filter((s) => !s.startsWith("Top foods:"));
    profile = `User profile: ${withoutFoods.join(". ")}.`;
  }

  if (profile.length > 1200) {
    // Remove today's meals section and rebuild
    const withoutMeals = sections.filter(
      (s) => !s.startsWith("Top foods:") && !s.startsWith("Today's meals:")
    );
    profile = `User profile: ${withoutMeals.join(". ")}.`;
  }

  l.debug(
    { action: "build_user_profile_success", userId, profileLength: profile.length },
    "user profile built"
  );

  return profile;
}
