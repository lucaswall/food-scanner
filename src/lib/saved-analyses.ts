import { getDb } from "@/db/index";
import { savedAnalyses } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import type { FoodAnalysis } from "@/types";

export async function saveAnalysis(
  userId: string,
  foodAnalysis: FoodAnalysis,
): Promise<{ id: number; createdAt: Date }> {
  const db = getDb();
  const rows = await db
    .insert(savedAnalyses)
    .values({
      userId,
      description: foodAnalysis.food_name,
      calories: foodAnalysis.calories,
      foodAnalysis: foodAnalysis as unknown as Record<string, unknown>,
    })
    .returning({ id: savedAnalyses.id, createdAt: savedAnalyses.createdAt });
  return rows[0];
}

export async function getSavedAnalyses(
  userId: string,
): Promise<{ id: number; description: string; calories: number; createdAt: Date }[]> {
  const db = getDb();
  return db
    .select({
      id: savedAnalyses.id,
      description: savedAnalyses.description,
      calories: savedAnalyses.calories,
      createdAt: savedAnalyses.createdAt,
    })
    .from(savedAnalyses)
    .where(eq(savedAnalyses.userId, userId))
    .orderBy(desc(savedAnalyses.createdAt));
}

export async function getSavedAnalysis(
  userId: string,
  id: number,
): Promise<{
  id: number;
  description: string;
  calories: number;
  createdAt: Date;
  foodAnalysis: FoodAnalysis;
} | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(savedAnalyses)
    .where(and(eq(savedAnalyses.id, id), eq(savedAnalyses.userId, userId)));
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    description: row.description,
    calories: row.calories,
    createdAt: row.createdAt,
    foodAnalysis: row.foodAnalysis as unknown as FoodAnalysis,
  };
}

export async function deleteSavedAnalysis(
  userId: string,
  id: number,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(savedAnalyses)
    .where(and(eq(savedAnalyses.id, id), eq(savedAnalyses.userId, userId)))
    .returning({ id: savedAnalyses.id });
  return rows.length > 0;
}
