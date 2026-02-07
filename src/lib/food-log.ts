import { eq, and, isNotNull, gte, lte, lt, desc, asc } from "drizzle-orm";
import { getDb } from "@/db/index";
import { customFoods, foodLogEntries } from "@/db/schema";
import type { CommonFood, FoodLogHistoryEntry } from "@/types";

export interface CustomFoodInput {
  foodName: string;
  amount: number;
  unitId: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  confidence: "high" | "medium" | "low";
  notes: string | null;
  fitbitFoodId?: number | null;
  keywords?: string[] | null;
}

export interface FoodLogEntryInput {
  customFoodId: number;
  mealTypeId: number;
  amount: number;
  unitId: number;
  date: string;
  time?: string | null;
  fitbitLogId?: number | null;
}

export async function insertCustomFood(
  email: string,
  data: CustomFoodInput,
): Promise<{ id: number; createdAt: Date }> {
  const db = getDb();
  const rows = await db
    .insert(customFoods)
    .values({
      email,
      foodName: data.foodName,
      amount: String(data.amount),
      unitId: data.unitId,
      calories: data.calories,
      proteinG: String(data.proteinG),
      carbsG: String(data.carbsG),
      fatG: String(data.fatG),
      fiberG: String(data.fiberG),
      sodiumMg: String(data.sodiumMg),
      confidence: data.confidence,
      notes: data.notes,
      fitbitFoodId: data.fitbitFoodId ?? null,
      keywords: data.keywords ?? null,
    })
    .returning({ id: customFoods.id, createdAt: customFoods.createdAt });

  const row = rows[0];
  if (!row) throw new Error("Failed to insert custom food: no row returned");
  return row;
}

export async function insertFoodLogEntry(
  email: string,
  data: FoodLogEntryInput,
): Promise<{ id: number; loggedAt: Date }> {
  const db = getDb();
  const rows = await db
    .insert(foodLogEntries)
    .values({
      email,
      customFoodId: data.customFoodId,
      mealTypeId: data.mealTypeId,
      amount: String(data.amount),
      unitId: data.unitId,
      date: data.date,
      time: data.time ?? null,
      fitbitLogId: data.fitbitLogId ?? null,
    })
    .returning({ id: foodLogEntries.id, loggedAt: foodLogEntries.loggedAt });

  const row = rows[0];
  if (!row) throw new Error("Failed to insert food log entry: no row returned");
  return row;
}

export async function getCustomFoodById(id: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(customFoods)
    .where(eq(customFoods.id, id));

  return rows[0] ?? null;
}

function parseTimeToMinutes(time: string | null): number {
  if (!time) return 0;
  const parts = time.split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function circularTimeDiff(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}

export async function getCommonFoods(
  email: string,
  currentTime: string,
): Promise<CommonFood[]> {
  const db = getDb();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoffDate = thirtyDaysAgo.toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(foodLogEntries)
    .innerJoin(customFoods, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(
      and(
        eq(foodLogEntries.email, email),
        isNotNull(customFoods.fitbitFoodId),
        gte(foodLogEntries.date, cutoffDate),
      ),
    );

  const currentMinutes = parseTimeToMinutes(currentTime);

  // Dedup by customFoodId, keeping entry with smallest time diff
  const bestByFood = new Map<
    number,
    { row: (typeof rows)[number]; timeDiff: number }
  >();

  for (const row of rows) {
    const entryMinutes = parseTimeToMinutes(row.food_log_entries.time);
    const timeDiff = circularTimeDiff(currentMinutes, entryMinutes);
    const foodId = row.custom_foods.id;

    const existing = bestByFood.get(foodId);
    if (!existing || timeDiff < existing.timeDiff) {
      bestByFood.set(foodId, { row, timeDiff });
    }
  }

  // Sort by ascending time diff, limit 5
  const sorted = [...bestByFood.values()]
    .sort((a, b) => a.timeDiff - b.timeDiff)
    .slice(0, 5);

  return sorted.map(({ row }) => ({
    customFoodId: row.custom_foods.id,
    foodName: row.custom_foods.foodName,
    amount: Number(row.custom_foods.amount),
    unitId: row.custom_foods.unitId,
    calories: row.custom_foods.calories,
    proteinG: Number(row.custom_foods.proteinG),
    carbsG: Number(row.custom_foods.carbsG),
    fatG: Number(row.custom_foods.fatG),
    fiberG: Number(row.custom_foods.fiberG),
    sodiumMg: Number(row.custom_foods.sodiumMg),
    fitbitFoodId: row.custom_foods.fitbitFoodId!,
    mealTypeId: row.food_log_entries.mealTypeId,
  }));
}

export async function getFoodLogHistory(
  email: string,
  options: { endDate?: string; afterId?: number; limit?: number },
): Promise<FoodLogHistoryEntry[]> {
  const db = getDb();
  const limit = options.limit ?? 20;

  const conditions = [eq(foodLogEntries.email, email)];
  if (options.endDate) {
    conditions.push(lte(foodLogEntries.date, options.endDate));
  }
  if (options.afterId) {
    conditions.push(lt(foodLogEntries.id, options.afterId));
  }

  const rows = await db
    .select()
    .from(foodLogEntries)
    .innerJoin(customFoods, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(and(...conditions))
    .orderBy(desc(foodLogEntries.date), asc(foodLogEntries.time))
    .limit(limit);

  return rows.map((row) => ({
    id: row.food_log_entries.id,
    foodName: row.custom_foods.foodName,
    calories: row.custom_foods.calories,
    proteinG: Number(row.custom_foods.proteinG),
    carbsG: Number(row.custom_foods.carbsG),
    fatG: Number(row.custom_foods.fatG),
    fiberG: Number(row.custom_foods.fiberG),
    sodiumMg: Number(row.custom_foods.sodiumMg),
    amount: Number(row.food_log_entries.amount),
    unitId: row.food_log_entries.unitId,
    mealTypeId: row.food_log_entries.mealTypeId,
    date: row.food_log_entries.date,
    time: row.food_log_entries.time,
    fitbitLogId: row.food_log_entries.fitbitLogId,
  }));
}

export async function getFoodLogEntry(email: string, id: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(foodLogEntries)
    .where(and(eq(foodLogEntries.id, id), eq(foodLogEntries.email, email)));

  return rows[0] ?? null;
}

export async function deleteFoodLogEntry(
  email: string,
  entryId: number,
): Promise<{ fitbitLogId: number | null } | null> {
  const db = getDb();
  const rows = await db
    .delete(foodLogEntries)
    .where(
      and(eq(foodLogEntries.id, entryId), eq(foodLogEntries.email, email)),
    )
    .returning({ fitbitLogId: foodLogEntries.fitbitLogId });

  const row = rows[0];
  if (!row) return null;
  return { fitbitLogId: row.fitbitLogId };
}
