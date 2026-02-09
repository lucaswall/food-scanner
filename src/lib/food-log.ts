import { eq, and, or, isNotNull, isNull, gte, lte, lt, gt, desc, asc } from "drizzle-orm";
import { getDb } from "@/db/index";
import { customFoods, foodLogEntries } from "@/db/schema";
import type { CommonFood, CommonFoodsCursor, CommonFoodsResponse, RecentFoodsCursor, RecentFoodsResponse, FoodLogHistoryEntry, FoodLogEntryDetail } from "@/types";

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
  description?: string | null;
  fitbitFoodId?: number | null;
  keywords?: string[] | null;
}

export interface FoodLogEntryInput {
  customFoodId: number;
  mealTypeId: number;
  amount: number;
  unitId: number;
  date: string;
  time: string;
  fitbitLogId?: number | null;
}

export async function insertCustomFood(
  userId: string,
  data: CustomFoodInput,
): Promise<{ id: number; createdAt: Date }> {
  const db = getDb();
  const rows = await db
    .insert(customFoods)
    .values({
      userId,
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
      description: data.description ?? null,
      fitbitFoodId: data.fitbitFoodId ?? null,
      keywords: data.keywords ?? null,
    })
    .returning({ id: customFoods.id, createdAt: customFoods.createdAt });

  const row = rows[0];
  if (!row) throw new Error("Failed to insert custom food: no row returned");
  return row;
}

export async function insertFoodLogEntry(
  userId: string,
  data: FoodLogEntryInput,
): Promise<{ id: number; loggedAt: Date }> {
  const db = getDb();
  const rows = await db
    .insert(foodLogEntries)
    .values({
      userId,
      customFoodId: data.customFoodId,
      mealTypeId: data.mealTypeId,
      amount: String(data.amount),
      unitId: data.unitId,
      date: data.date,
      time: data.time,
      fitbitLogId: data.fitbitLogId ?? null,
    })
    .returning({ id: foodLogEntries.id, loggedAt: foodLogEntries.loggedAt });

  const row = rows[0];
  if (!row) throw new Error("Failed to insert food log entry: no row returned");
  return row;
}

export async function getCustomFoodById(userId: string, id: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(customFoods)
    .where(and(eq(customFoods.id, id), eq(customFoods.userId, userId)));

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

interface JoinedRow {
  food_log_entries: {
    id: number;
    userId: string;
    customFoodId: number;
    mealTypeId: number;
    amount: string;
    unitId: number;
    date: string;
    time: string;
    fitbitLogId: number | null;
    loggedAt: Date;
  };
  custom_foods: {
    id: number;
    userId: string;
    foodName: string;
    amount: string;
    unitId: number;
    calories: number;
    proteinG: string;
    carbsG: string;
    fatG: string;
    fiberG: string;
    sodiumMg: string;
    fitbitFoodId: number | null;
    confidence: string;
    notes: string | null;
    keywords: string[] | null;
    createdAt: Date;
  };
}

function mapRowToCommonFood(row: JoinedRow): CommonFood {
  return {
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
    fitbitFoodId: row.custom_foods.fitbitFoodId ?? null,
    mealTypeId: row.food_log_entries.mealTypeId,
  };
}

/** Gaussian kernel for time-of-day similarity. σ = 90 minutes. */
function gaussianTimeKernel(diffMinutes: number): number {
  const sigma = 90;
  return Math.exp(-0.5 * (diffMinutes / sigma) ** 2);
}

/** Exponential recency decay. Half-life = 7 days. */
function recencyDecay(daysAgo: number): number {
  const halfLife = 7;
  return Math.exp((-Math.LN2 * daysAgo) / halfLife);
}

/** 1.3x boost when entry was logged on the same day of the week. */
function dayOfWeekBoost(entryDate: string, currentDate: string): number {
  const entryDay = new Date(entryDate + "T00:00:00").getDay();
  const currentDay = new Date(currentDate + "T00:00:00").getDay();
  return entryDay === currentDay ? 1.3 : 1.0;
}

export async function getCommonFoods(
  userId: string,
  currentTime: string,
  currentDate: string,
  options: { limit?: number; cursor?: CommonFoodsCursor } = {},
): Promise<CommonFoodsResponse> {
  const db = getDb();
  const limit = options.limit ?? 10;

  const cutoff = new Date(currentDate + "T00:00:00");
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(foodLogEntries)
    .innerJoin(customFoods, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        ...(process.env.FITBIT_DRY_RUN !== "true" ? [isNotNull(customFoods.fitbitFoodId)] : []),
        gte(foodLogEntries.date, cutoffDate),
      ),
    );

  const currentMinutes = parseTimeToMinutes(currentTime);

  // Accumulate scores per customFoodId, track best entry per food
  const scoreByFood = new Map<
    number,
    { totalScore: number; bestScore: number; bestRow: (typeof rows)[number] }
  >();

  for (const row of rows) {
    const entryMinutes = parseTimeToMinutes(row.food_log_entries.time);
    const timeDiff = circularTimeDiff(currentMinutes, entryMinutes);
    const daysAgo = Math.max(0, (new Date(currentDate + "T00:00:00").getTime() - new Date(row.food_log_entries.date + "T00:00:00").getTime()) / 86400000);
    const entryScore =
      gaussianTimeKernel(timeDiff) *
      recencyDecay(daysAgo) *
      dayOfWeekBoost(row.food_log_entries.date, currentDate);

    const foodId = row.custom_foods.id;
    const existing = scoreByFood.get(foodId);

    if (!existing) {
      scoreByFood.set(foodId, { totalScore: entryScore, bestScore: entryScore, bestRow: row });
    } else {
      existing.totalScore += entryScore;
      if (entryScore > existing.bestScore) {
        existing.bestScore = entryScore;
        existing.bestRow = row;
      }
    }
  }

  // Sort by descending total score
  let sorted = [...scoreByFood.values()]
    .sort((a, b) => b.totalScore - a.totalScore);

  // Cursor-based pagination: composite cursor {score, id} for stable pagination
  if (options.cursor !== undefined) {
    const { score: cursorScore, id: cursorId } = options.cursor;
    sorted = sorted.filter((item) => {
      const foodId = item.bestRow.custom_foods.id;
      return item.totalScore < cursorScore ||
        (item.totalScore === cursorScore && foodId > cursorId);
    });
  }

  // Fetch limit + 1 to detect if more items exist
  const hasMore = sorted.length > limit;
  const page = sorted.slice(0, limit);

  const foods: CommonFood[] = page.map(({ bestRow }) => mapRowToCommonFood(bestRow));

  const lastItem = page.length > 0 ? page[page.length - 1] : null;
  const nextCursor: CommonFoodsCursor | null = hasMore && lastItem
    ? { score: lastItem.totalScore, id: lastItem.bestRow.custom_foods.id }
    : null;

  return { foods, nextCursor };
}

export async function getRecentFoods(
  userId: string,
  options: { limit?: number; cursor?: RecentFoodsCursor } = {},
): Promise<RecentFoodsResponse> {
  const db = getDb();
  const limit = options.limit ?? 10;

  const conditions = [eq(foodLogEntries.userId, userId)];

  if (process.env.FITBIT_DRY_RUN !== "true") {
    conditions.push(isNotNull(customFoods.fitbitFoodId));
  }

  if (options.cursor) {
    const { lastDate, lastTime, lastId } = options.cursor;
    const cursorCondition = lastTime !== null
      ? or(
          lt(foodLogEntries.date, lastDate),
          and(eq(foodLogEntries.date, lastDate), lt(foodLogEntries.time, lastTime)),
          and(eq(foodLogEntries.date, lastDate), eq(foodLogEntries.time, lastTime), gt(foodLogEntries.id, lastId)),
          and(eq(foodLogEntries.date, lastDate), isNull(foodLogEntries.time)),
        )
      : or(
          lt(foodLogEntries.date, lastDate),
          and(eq(foodLogEntries.date, lastDate), isNull(foodLogEntries.time), gt(foodLogEntries.id, lastId)),
        );
    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select()
    .from(foodLogEntries)
    .innerJoin(customFoods, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(and(...conditions))
    .orderBy(desc(foodLogEntries.date), desc(foodLogEntries.time), asc(foodLogEntries.id))
    .limit(limit * 3);

  // Dedup by customFoodId, keeping the most recent entry (first occurrence in DESC order)
  const seenFoods = new Set<number>();
  const deduped: typeof rows = [];
  for (const row of rows) {
    const foodId = row.custom_foods.id;
    if (!seenFoods.has(foodId)) {
      seenFoods.add(foodId);
      deduped.push(row);
    }
  }

  const hasMore = deduped.length > limit;
  const page = deduped.slice(0, limit);

  const foods: CommonFood[] = page.map(mapRowToCommonFood);

  const lastRow = page.length > 0 ? page[page.length - 1] : null;
  const nextCursor: RecentFoodsCursor | null = hasMore && lastRow
    ? {
        lastDate: lastRow.food_log_entries.date,
        lastTime: lastRow.food_log_entries.time,
        lastId: lastRow.food_log_entries.id,
      }
    : null;

  return { foods, nextCursor };
}

export async function getFoodLogHistory(
  userId: string,
  options: { endDate?: string; cursor?: { lastDate: string; lastTime: string | null; lastId: number }; limit?: number },
): Promise<FoodLogHistoryEntry[]> {
  const db = getDb();
  const limit = options.limit ?? 20;

  const conditions = [eq(foodLogEntries.userId, userId)];
  if (options.endDate) {
    conditions.push(lte(foodLogEntries.date, options.endDate));
  }
  if (options.cursor) {
    const { lastDate, lastTime, lastId } = options.cursor;
    // Composite cursor for (date DESC, time ASC) ordering.
    // Next page entries come after the cursor in sort order.
    const cursorCondition = lastTime !== null
      ? or(
          lt(foodLogEntries.date, lastDate),
          and(eq(foodLogEntries.date, lastDate), gt(foodLogEntries.time, lastTime)),
          and(eq(foodLogEntries.date, lastDate), eq(foodLogEntries.time, lastTime), gt(foodLogEntries.id, lastId)),
          and(eq(foodLogEntries.date, lastDate), isNull(foodLogEntries.time)),
        )
      : or(
          lt(foodLogEntries.date, lastDate),
          and(eq(foodLogEntries.date, lastDate), isNull(foodLogEntries.time), gt(foodLogEntries.id, lastId)),
        );
    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select()
    .from(foodLogEntries)
    .innerJoin(customFoods, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(and(...conditions))
    .orderBy(desc(foodLogEntries.date), asc(foodLogEntries.time), asc(foodLogEntries.id))
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

export async function getFoodLogEntry(userId: string, id: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(foodLogEntries)
    .where(and(eq(foodLogEntries.id, id), eq(foodLogEntries.userId, userId)));

  return rows[0] ?? null;
}

export async function getFoodLogEntryDetail(
  userId: string,
  id: number,
): Promise<FoodLogEntryDetail | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(foodLogEntries)
    .innerJoin(customFoods, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(and(eq(foodLogEntries.id, id), eq(foodLogEntries.userId, userId)));

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.food_log_entries.id,
    foodName: row.custom_foods.foodName,
    description: row.custom_foods.description,
    notes: row.custom_foods.notes,
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
    confidence: row.custom_foods.confidence,
  };
}

export async function deleteFoodLogEntry(
  userId: string,
  entryId: number,
): Promise<{ fitbitLogId: number | null } | null> {
  const db = getDb();

  return db.transaction(async (tx) => {
    // Delete the entry and get its customFoodId
    const rows = await tx
      .delete(foodLogEntries)
      .where(
        and(eq(foodLogEntries.id, entryId), eq(foodLogEntries.userId, userId)),
      )
      .returning({
        fitbitLogId: foodLogEntries.fitbitLogId,
        customFoodId: foodLogEntries.customFoodId,
      });

    const row = rows[0];
    if (!row) return null;

    // Check if the custom food is still referenced by other entries
    const remainingEntries = await tx
      .select({ id: foodLogEntries.id })
      .from(foodLogEntries)
      .where(eq(foodLogEntries.customFoodId, row.customFoodId));

    // If no remaining entries reference this custom food, delete it
    if (remainingEntries.length === 0) {
      await tx
        .delete(customFoods)
        .where(eq(customFoods.id, row.customFoodId));
    }

    return { fitbitLogId: row.fitbitLogId };
  });
}

export async function searchFoods(
  userId: string,
  query: string,
  options: { limit?: number } = {},
): Promise<CommonFood[]> {
  const db = getDb();
  const limit = options.limit ?? 10;
  const lowerQuery = query.toLowerCase();

  const conditions = [eq(customFoods.userId, userId)];

  if (process.env.FITBIT_DRY_RUN !== "true") {
    conditions.push(isNotNull(customFoods.fitbitFoodId));
  }

  const rows = await db
    .select()
    .from(customFoods)
    .leftJoin(foodLogEntries, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(and(...conditions));

  // Application-level filtering by name or keywords
  const filtered = rows.filter((row) => {
    const nameMatch = row.custom_foods.foodName.toLowerCase().includes(lowerQuery);
    const keywordMatch = row.custom_foods.keywords?.some(
      (kw) => kw.toLowerCase().includes(lowerQuery),
    ) ?? false;
    return nameMatch || keywordMatch;
  });

  // Group by customFoodId: count entries, track max date, keep best mealTypeId
  const grouped = new Map<
    number,
    { row: (typeof filtered)[number]; count: number; maxDate: string | null; bestEntry: (typeof filtered)[number] | null }
  >();

  for (const row of filtered) {
    const foodId = row.custom_foods.id;
    const existing = grouped.get(foodId);
    const entryDate = row.food_log_entries?.date ?? null;

    if (!existing) {
      grouped.set(foodId, {
        row,
        count: entryDate ? 1 : 0,
        maxDate: entryDate,
        bestEntry: row.food_log_entries ? row : null,
      });
    } else {
      if (entryDate) {
        existing.count += 1;
        if (!existing.maxDate || entryDate > existing.maxDate) {
          existing.maxDate = entryDate;
          existing.bestEntry = row;
        }
      }
    }
  }

  // Sort by count DESC, then maxDate DESC
  const sorted = [...grouped.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const dateA = a.maxDate ?? "";
      const dateB = b.maxDate ?? "";
      return dateB.localeCompare(dateA);
    })
    .slice(0, limit);

  return sorted.map(({ row, bestEntry }) => {
    const entryRow = bestEntry ?? row;
    return {
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
      fitbitFoodId: row.custom_foods.fitbitFoodId ?? null,
      mealTypeId: entryRow.food_log_entries?.mealTypeId ?? 7,
    };
  });
}
