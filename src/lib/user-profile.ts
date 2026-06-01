import { getDb } from "@/db/index";
import { foodLogEntries, customFoods } from "@/db/schema";
import { eq, and, gte, desc, count } from "drizzle-orm";
import { getOrComputeDailyGoals } from "@/lib/daily-goals";
import { getDailyNutritionSummary } from "@/lib/food-log";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { MEAL_TYPE_LABELS } from "@/types";

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

  // FOO-1064: goals are optional enrichment for the chat profile. Isolate the
  // goal-compute promise so a transient Fitbit error (token invalid, rate
  // limited, timeout) does not discard the DB-only nutrition summary and
  // top-foods context, which may have succeeded.
  const [goalsSettled, nutritionSummary, topFoods] = await Promise.all([
    getOrComputeDailyGoals(userId, currentDate, l).then(
      (value) => ({ ok: true as const, value }),
      (err: unknown) => {
        l.warn(
          {
            action: "build_user_profile_goals_failed",
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          "goal compute threw — degrading to base profile without targets",
        );
        return { ok: false as const };
      },
    ),
    getDailyNutritionSummary(userId, currentDate),
    getTopFoodsByFrequency(userId, currentDate),
  ]);

  const goalsResult = goalsSettled.ok ? goalsSettled.value : null;
  const calorieGoal = goalsResult?.status === "ok" ? goalsResult.goals.calorieGoal : null;
  const hasGoals = goalsResult?.status === "ok";
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
  // FOO-1069: include non-positive `calorieGoal` (extreme rate, no clamp by
  // design) — the engine output is what the user opted into via the safety
  // warning. Filtering it here silently dropped the target line even when
  // `hasGoals` was true.
  if (calorieGoal !== null && goalsResult?.status === "ok") {
    const { proteinGoal, carbsGoal, fatGoal } = goalsResult.goals;
    if (proteinGoal > 0 && carbsGoal > 0 && fatGoal > 0) {
      sections.push(
        `Targets ${calorieGoal} cal/day (P:${proteinGoal}g C:${carbsGoal}g F:${fatGoal}g)`
      );
    } else {
      sections.push(`Targets ${calorieGoal} cal/day`);
    }
  } else if (goalsResult?.status === "blocked" && goalsResult.reason === "goals_not_set") {
    // User hasn't declared their activity level / goal weight / goal rate yet.
    sections.push("Targets pending — set up daily goals in Settings");
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
      const label = MEAL_TYPE_LABELS[group.mealTypeId] ?? `Meal ${group.mealTypeId}`;
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
