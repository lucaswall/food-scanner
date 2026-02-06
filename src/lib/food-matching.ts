import { getDb } from "@/db/index";
import { customFoods, foodLogEntries } from "@/db/schema";
import { eq, and, isNotNull, max } from "drizzle-orm";
import type { FoodAnalysis, FoodMatch } from "@/types";

export type { FoodMatch };

export interface NutrientValues {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * Computes the ratio of new keywords found in existing keywords.
 * Returns a value between 0 and 1.
 */
export function computeMatchRatio(
  newKeywords: string[],
  existingKeywords: string[],
): number {
  if (newKeywords.length === 0) return 0;

  const existingSet = new Set(existingKeywords);
  let matches = 0;
  for (const keyword of newKeywords) {
    if (existingSet.has(keyword)) {
      matches++;
    }
  }
  return matches / newKeywords.length;
}

/**
 * Checks if two foods have similar nutrients within defined thresholds.
 * Thresholds: calories ±20%/±25, protein ±25%/±3, carbs ±25%/±5, fat ±25%/±3.
 * Each check: |newVal - existVal| <= max(existVal * pct, absolute)
 */
export function checkNutrientTolerance(
  newFood: NutrientValues,
  existingFood: NutrientValues,
): boolean {
  const checks: Array<{
    newVal: number;
    existVal: number;
    pct: number;
    abs: number;
  }> = [
    { newVal: newFood.calories, existVal: existingFood.calories, pct: 0.2, abs: 25 },
    { newVal: newFood.proteinG, existVal: existingFood.proteinG, pct: 0.25, abs: 3 },
    { newVal: newFood.carbsG, existVal: existingFood.carbsG, pct: 0.25, abs: 5 },
    { newVal: newFood.fatG, existVal: existingFood.fatG, pct: 0.25, abs: 3 },
  ];

  return checks.every(
    ({ newVal, existVal, pct, abs }) =>
      Math.abs(newVal - existVal) <= Math.max(existVal * pct, abs),
  );
}

/**
 * Finds matching custom foods for a user based on keyword overlap and nutrient tolerance.
 * Returns up to 3 matches sorted by match_ratio desc, then lastLoggedAt desc.
 */
export async function findMatchingFoods(
  email: string,
  newAnalysis: FoodAnalysis,
): Promise<FoodMatch[]> {
  const db = getDb();

  const rows = await db
    .select({
      custom_foods: {
        id: customFoods.id,
        foodName: customFoods.foodName,
        calories: customFoods.calories,
        proteinG: customFoods.proteinG,
        carbsG: customFoods.carbsG,
        fatG: customFoods.fatG,
        fitbitFoodId: customFoods.fitbitFoodId,
        keywords: customFoods.keywords,
        createdAt: customFoods.createdAt,
        amount: customFoods.amount,
        unitId: customFoods.unitId,
      },
      lastLoggedAt: max(foodLogEntries.loggedAt),
    })
    .from(customFoods)
    .leftJoin(
      foodLogEntries,
      eq(customFoods.id, foodLogEntries.customFoodId),
    )
    .where(
      and(
        eq(customFoods.email, email),
        isNotNull(customFoods.keywords),
        isNotNull(customFoods.fitbitFoodId),
      ),
    )
    .groupBy(customFoods.id);

  const matches: Array<FoodMatch & { sortDate: number }> = [];

  for (const row of rows) {
    const food = row.custom_foods;
    if (!food.keywords || !food.fitbitFoodId) continue;

    const matchRatio = computeMatchRatio(newAnalysis.keywords, food.keywords);
    if (matchRatio < 0.5) continue;

    const existingNutrients: NutrientValues = {
      calories: food.calories,
      proteinG: Number(food.proteinG),
      carbsG: Number(food.carbsG),
      fatG: Number(food.fatG),
    };

    const newNutrients: NutrientValues = {
      calories: newAnalysis.calories,
      proteinG: newAnalysis.protein_g,
      carbsG: newAnalysis.carbs_g,
      fatG: newAnalysis.fat_g,
    };

    if (!checkNutrientTolerance(newNutrients, existingNutrients)) continue;

    const lastLoggedAt = row.lastLoggedAt ?? food.createdAt;

    matches.push({
      customFoodId: food.id,
      foodName: food.foodName,
      calories: food.calories,
      proteinG: Number(food.proteinG),
      carbsG: Number(food.carbsG),
      fatG: Number(food.fatG),
      fitbitFoodId: food.fitbitFoodId,
      matchRatio,
      lastLoggedAt,
      amount: Number(food.amount),
      unitId: food.unitId,
      sortDate: lastLoggedAt.getTime(),
    });
  }

  matches.sort((a, b) => {
    if (b.matchRatio !== a.matchRatio) return b.matchRatio - a.matchRatio;
    return b.sortDate - a.sortDate;
  });

  return matches.slice(0, 3).map((m): FoodMatch => ({
    customFoodId: m.customFoodId,
    foodName: m.foodName,
    calories: m.calories,
    proteinG: m.proteinG,
    carbsG: m.carbsG,
    fatG: m.fatG,
    fitbitFoodId: m.fitbitFoodId,
    matchRatio: m.matchRatio,
    lastLoggedAt: m.lastLoggedAt,
    amount: m.amount,
    unitId: m.unitId,
  }));
}
