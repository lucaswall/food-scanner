import { getDb } from "@/db/index";
import { foodLogs } from "@/db/schema";

export interface FoodLogInput {
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
  mealTypeId: number;
  date: string;
  time?: string | null;
  fitbitFoodId?: number | null;
  fitbitLogId?: number | null;
}

export async function insertFoodLog(
  email: string,
  data: FoodLogInput,
): Promise<{ id: number; loggedAt: Date }> {
  const db = getDb();
  const rows = await db
    .insert(foodLogs)
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
      mealTypeId: data.mealTypeId,
      date: data.date,
      time: data.time ?? null,
      fitbitFoodId: data.fitbitFoodId ?? null,
      fitbitLogId: data.fitbitLogId ?? null,
    })
    .returning({ id: foodLogs.id, loggedAt: foodLogs.loggedAt });

  const row = rows[0];
  if (!row) throw new Error("Failed to insert food log: no row returned");
  return row;
}
