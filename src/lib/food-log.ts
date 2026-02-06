import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { customFoods, foodLogEntries } from "@/db/schema";

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
