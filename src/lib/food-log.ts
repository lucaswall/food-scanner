import { eq, and, or, isNotNull, isNull, gte, lte, lt, gt, desc, asc, between, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "@/db/index";
import { customFoods, foodLogEntries } from "@/db/schema";
import { computeMatchRatio } from "@/lib/food-matching";
import type { CommonFood, CommonFoodsCursor, CommonFoodsResponse, RecentFoodsCursor, RecentFoodsResponse, FoodLogHistoryEntry, FoodLogEntryDetail, DailyNutritionTotals } from "@/types";
import { getCalorieGoalsByDateRange } from "@/lib/nutrition-goals";
import { getLumenGoalsByDateRange } from "@/lib/lumen";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

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
  saturatedFatG?: number | null;
  transFatG?: number | null;
  sugarsG?: number | null;
  caloriesFromFat?: number | null;
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

export interface UpdateFoodLogInput {
  foodName: string;
  amount: number;
  unitId: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  saturatedFatG?: number | null;
  transFatG?: number | null;
  sugarsG?: number | null;
  caloriesFromFat?: number | null;
  confidence: "high" | "medium" | "low";
  notes: string | null;
  description?: string | null;
  keywords?: string[] | null;
  mealTypeId: number;
  date: string;
  time: string;
  fitbitLogId?: number | null;
}

export async function insertCustomFood(
  userId: string,
  data: CustomFoodInput,
  log?: Logger,
): Promise<{ id: number; createdAt: Date }> {
  const l = log ?? logger;
  const db = getDb();
  const rows = await db
    .insert(customFoods)
    .values({
      userId,
      foodName: data.foodName,
      amount: String(data.amount),
      unitId: data.unitId,
      calories: Math.round(data.calories),
      proteinG: String(data.proteinG),
      carbsG: String(data.carbsG),
      fatG: String(data.fatG),
      fiberG: String(data.fiberG),
      sodiumMg: String(data.sodiumMg),
      saturatedFatG: data.saturatedFatG != null ? String(data.saturatedFatG) : null,
      transFatG: data.transFatG != null ? String(data.transFatG) : null,
      sugarsG: data.sugarsG != null ? String(data.sugarsG) : null,
      caloriesFromFat: data.caloriesFromFat != null ? String(data.caloriesFromFat) : null,
      confidence: data.confidence,
      notes: data.notes,
      description: data.description ?? null,
      fitbitFoodId: data.fitbitFoodId ?? null,
      keywords: data.keywords ?? null,
    })
    .returning({ id: customFoods.id, createdAt: customFoods.createdAt });

  const row = rows[0];
  if (!row) throw new Error("Failed to insert custom food: no row returned");
  l.debug({ action: "insert_custom_food", foodName: data.foodName, calories: data.calories, customFoodId: row.id }, "custom food inserted");
  return row;
}

export async function insertFoodLogEntry(
  userId: string,
  data: FoodLogEntryInput,
  log?: Logger,
): Promise<{ id: number; loggedAt: Date }> {
  const l = log ?? logger;
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
  l.debug({ action: "insert_food_log_entry", date: data.date, mealTypeId: data.mealTypeId, entryId: row.id }, "food log entry inserted");
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

export async function toggleFavorite(
  userId: string,
  customFoodId: number,
): Promise<{ isFavorite: boolean } | null> {
  const db = getDb();
  const rows = await db
    .update(customFoods)
    .set({ isFavorite: sql`NOT ${customFoods.isFavorite}` })
    .where(and(eq(customFoods.id, customFoodId), eq(customFoods.userId, userId)))
    .returning({ isFavorite: customFoods.isFavorite });

  const row = rows[0];
  if (!row) return null;
  return { isFavorite: row.isFavorite };
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
    saturatedFatG: string | null;
    transFatG: string | null;
    sugarsG: string | null;
    caloriesFromFat: string | null;
    fitbitFoodId: number | null;
    confidence: string;
    notes: string | null;
    description: string | null;
    keywords: string[] | null;
    isFavorite: boolean;
    shareToken: string | null;
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
    saturatedFatG: row.custom_foods.saturatedFatG != null ? Number(row.custom_foods.saturatedFatG) : null,
    transFatG: row.custom_foods.transFatG != null ? Number(row.custom_foods.transFatG) : null,
    sugarsG: row.custom_foods.sugarsG != null ? Number(row.custom_foods.sugarsG) : null,
    caloriesFromFat: row.custom_foods.caloriesFromFat != null ? Number(row.custom_foods.caloriesFromFat) : null,
    fitbitFoodId: row.custom_foods.fitbitFoodId ?? null,
    mealTypeId: row.food_log_entries.mealTypeId,
    isFavorite: row.custom_foods.isFavorite,
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
  log?: Logger,
): Promise<CommonFoodsResponse> {
  const l = log ?? logger;
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
  const allSorted = [...scoreByFood.values()]
    .sort((a, b) => b.totalScore - a.totalScore);

  // Separate favorites from non-favorites — favorites are pinned on page 1 only,
  // and the cursor system only paginates over non-favorites to avoid duplicates
  const favorites = allSorted.filter(item => item.bestRow.custom_foods.isFavorite);
  const nonFavorites = allSorted.filter(item => !item.bestRow.custom_foods.isFavorite);

  // Cursor-based pagination over non-favorites only
  let paginatedNonFavorites = nonFavorites;
  if (options.cursor !== undefined) {
    const { score: cursorScore, id: cursorId } = options.cursor;
    paginatedNonFavorites = nonFavorites.filter((item) => {
      const foodId = item.bestRow.custom_foods.id;
      return item.totalScore < cursorScore ||
        (item.totalScore === cursorScore && foodId > cursorId);
    });
  }

  // Page 1: favorites (sorted by date desc) + fill remaining slots with scored non-favorites
  // Page 2+: only non-favorites (cursor already filtered above)
  let page: typeof allSorted;
  if (options.cursor === undefined) {
    favorites.sort((a, b) =>
      b.bestRow.food_log_entries.date.localeCompare(a.bestRow.food_log_entries.date),
    );
    const remainingSlots = Math.max(0, limit - favorites.length);
    const hasMore = paginatedNonFavorites.length > remainingSlots;
    page = [...favorites, ...paginatedNonFavorites.slice(0, remainingSlots)];
    let nextCursor: CommonFoodsCursor | null = null;
    if (hasMore) {
      // Use the last non-favorite shown on this page as cursor anchor,
      // or the first non-favorite if favorites filled all slots (remainingSlots === 0).
      // When remainingSlots === 0, no non-favorites were shown on page 1, so the cursor
      // must include ALL non-favorites on page 2. We use score+1 with id=0 as a sentinel
      // that passes the filter `score < cursorScore || (score === cursorScore && id > 0)`.
      // Invariant: all totalScores are in (0, ~1.3] per entry, so +1 safely exceeds all items.
      const cursorItem = remainingSlots > 0
        ? paginatedNonFavorites[remainingSlots - 1]
        : paginatedNonFavorites[0];
      if (cursorItem) {
        nextCursor = remainingSlots > 0
          ? { score: cursorItem.totalScore, id: cursorItem.bestRow.custom_foods.id }
          : { score: cursorItem.totalScore + 1, id: 0 };
      }
    }
    const foods: CommonFood[] = page.map(({ bestRow }) => mapRowToCommonFood(bestRow));
    l.debug({ action: "get_common_foods", resultCount: foods.length, hasMore }, "common foods retrieved");
    return { foods, nextCursor };
  }

  // Page 2+: only non-favorites
  const hasMore = paginatedNonFavorites.length > limit;
  page = paginatedNonFavorites.slice(0, limit);

  const foods: CommonFood[] = page.map(({ bestRow }) => mapRowToCommonFood(bestRow));

  const lastItem = page.length > 0 ? page[page.length - 1] : null;
  const nextCursor: CommonFoodsCursor | null = hasMore && lastItem
    ? { score: lastItem.totalScore, id: lastItem.bestRow.custom_foods.id }
    : null;

  l.debug({ action: "get_common_foods", resultCount: foods.length, hasMore }, "common foods retrieved");
  return { foods, nextCursor };
}

export async function getRecentFoods(
  userId: string,
  options: { limit?: number; cursor?: RecentFoodsCursor } = {},
  log?: Logger,
): Promise<RecentFoodsResponse> {
  const l = log ?? logger;
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

  l.debug({ action: "get_recent_foods", resultCount: foods.length, hasMore }, "recent foods retrieved");
  return { foods, nextCursor };
}

export async function getFoodLogHistory(
  userId: string,
  options: { startDate?: string; endDate?: string; cursor?: { lastDate: string; lastTime: string | null; lastId: number }; limit?: number },
  log?: Logger,
): Promise<FoodLogHistoryEntry[]> {
  const l = log ?? logger;
  const db = getDb();
  const limit = options.limit ?? 20;

  const conditions = [eq(foodLogEntries.userId, userId)];
  if (options.startDate) {
    conditions.push(gte(foodLogEntries.date, options.startDate));
  }
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

  const result = rows.map((row) => ({
    id: row.food_log_entries.id,
    customFoodId: row.custom_foods.id,
    foodName: row.custom_foods.foodName,
    calories: row.custom_foods.calories,
    proteinG: Number(row.custom_foods.proteinG),
    carbsG: Number(row.custom_foods.carbsG),
    fatG: Number(row.custom_foods.fatG),
    fiberG: Number(row.custom_foods.fiberG),
    sodiumMg: Number(row.custom_foods.sodiumMg),
    saturatedFatG: row.custom_foods.saturatedFatG != null ? Number(row.custom_foods.saturatedFatG) : null,
    transFatG: row.custom_foods.transFatG != null ? Number(row.custom_foods.transFatG) : null,
    sugarsG: row.custom_foods.sugarsG != null ? Number(row.custom_foods.sugarsG) : null,
    caloriesFromFat: row.custom_foods.caloriesFromFat != null ? Number(row.custom_foods.caloriesFromFat) : null,
    amount: Number(row.food_log_entries.amount),
    unitId: row.food_log_entries.unitId,
    mealTypeId: row.food_log_entries.mealTypeId,
    date: row.food_log_entries.date,
    time: row.food_log_entries.time,
    fitbitLogId: row.food_log_entries.fitbitLogId,
  }));
  l.debug({ action: "get_food_log_history", startDate: options.startDate, endDate: options.endDate, entryCount: result.length }, "food log history retrieved");
  return result;
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
    customFoodId: row.custom_foods.id,
    foodName: row.custom_foods.foodName,
    description: row.custom_foods.description,
    notes: row.custom_foods.notes,
    calories: row.custom_foods.calories,
    proteinG: Number(row.custom_foods.proteinG),
    carbsG: Number(row.custom_foods.carbsG),
    fatG: Number(row.custom_foods.fatG),
    fiberG: Number(row.custom_foods.fiberG),
    sodiumMg: Number(row.custom_foods.sodiumMg),
    saturatedFatG: row.custom_foods.saturatedFatG != null ? Number(row.custom_foods.saturatedFatG) : null,
    transFatG: row.custom_foods.transFatG != null ? Number(row.custom_foods.transFatG) : null,
    sugarsG: row.custom_foods.sugarsG != null ? Number(row.custom_foods.sugarsG) : null,
    caloriesFromFat: row.custom_foods.caloriesFromFat != null ? Number(row.custom_foods.caloriesFromFat) : null,
    amount: Number(row.food_log_entries.amount),
    unitId: row.food_log_entries.unitId,
    mealTypeId: row.food_log_entries.mealTypeId,
    date: row.food_log_entries.date,
    time: row.food_log_entries.time,
    fitbitLogId: row.food_log_entries.fitbitLogId,
    confidence: row.custom_foods.confidence,
    isFavorite: row.custom_foods.isFavorite,
  };
}

type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function cleanupOrphanCustomFood(tx: DbTx, customFoodId: number): Promise<boolean> {
  const remainingEntries = await tx
    .select({ id: foodLogEntries.id })
    .from(foodLogEntries)
    .where(eq(foodLogEntries.customFoodId, customFoodId));

  if (remainingEntries.length === 0) {
    await tx
      .delete(customFoods)
      .where(eq(customFoods.id, customFoodId));
    return true;
  }
  return false;
}

export async function deleteFoodLogEntry(
  userId: string,
  entryId: number,
  log?: Logger,
): Promise<{ fitbitLogId: number | null } | null> {
  const l = log ?? logger;
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

    const orphanedFoodCleaned = await cleanupOrphanCustomFood(tx, row.customFoodId);

    l.debug({ action: "delete_food_log_entry", entryId, orphanedFoodCleaned }, "food log entry deleted");
    return { fitbitLogId: row.fitbitLogId };
  });
}

export async function updateFoodLogEntry(
  userId: string,
  entryId: number,
  data: UpdateFoodLogInput,
  log?: Logger,
): Promise<{ fitbitLogId: number | null; newCustomFoodId: number } | null> {
  const l = log ?? logger;
  const db = getDb();

  return db.transaction(async (tx) => {
    // Fetch current entry to get customFoodId and fitbitLogId
    const rows = await tx
      .select({
        customFoodId: foodLogEntries.customFoodId,
        fitbitLogId: foodLogEntries.fitbitLogId,
      })
      .from(foodLogEntries)
      .where(and(eq(foodLogEntries.id, entryId), eq(foodLogEntries.userId, userId)));

    const row = rows[0];
    if (!row) return null;

    const oldCustomFoodId = row.customFoodId;

    // Fetch metadata from old custom food to preserve during replacement
    const oldFoodRows = await tx
      .select({
        fitbitFoodId: customFoods.fitbitFoodId,
        isFavorite: customFoods.isFavorite,
        shareToken: customFoods.shareToken,
      })
      .from(customFoods)
      .where(eq(customFoods.id, oldCustomFoodId));
    const oldFood = oldFoodRows[0];

    // Insert new custom food with updated values, preserving metadata from old record
    const newFoods = await tx
      .insert(customFoods)
      .values({
        userId,
        foodName: data.foodName,
        amount: String(data.amount),
        unitId: data.unitId,
        calories: Math.round(data.calories),
        proteinG: String(data.proteinG),
        carbsG: String(data.carbsG),
        fatG: String(data.fatG),
        fiberG: String(data.fiberG),
        sodiumMg: String(data.sodiumMg),
        saturatedFatG: data.saturatedFatG != null ? String(data.saturatedFatG) : null,
        transFatG: data.transFatG != null ? String(data.transFatG) : null,
        sugarsG: data.sugarsG != null ? String(data.sugarsG) : null,
        caloriesFromFat: data.caloriesFromFat != null ? String(data.caloriesFromFat) : null,
        confidence: data.confidence,
        notes: data.notes,
        description: data.description ?? null,
        keywords: data.keywords ?? null,
        fitbitFoodId: oldFood?.fitbitFoodId ?? null,
        isFavorite: oldFood?.isFavorite ?? false,
        shareToken: oldFood?.shareToken ?? null,
      })
      .returning({ id: customFoods.id });

    const newFood = newFoods[0];
    if (!newFood) throw new Error("Failed to insert updated custom food: no row returned");

    // Update the food log entry to point to the new custom food
    await tx
      .update(foodLogEntries)
      .set({
        customFoodId: newFood.id,
        amount: String(data.amount),
        unitId: data.unitId,
        mealTypeId: data.mealTypeId,
        date: data.date,
        time: data.time,
        ...(data.fitbitLogId !== undefined ? { fitbitLogId: data.fitbitLogId } : {}),
      })
      .where(eq(foodLogEntries.id, entryId));

    // Clean up old custom food if no longer referenced
    await cleanupOrphanCustomFood(tx, oldCustomFoodId);

    l.debug({ action: "update_food_log_entry", entryId, newCustomFoodId: newFood.id }, "food log entry updated");
    return { fitbitLogId: row.fitbitLogId, newCustomFoodId: newFood.id };
  });
}

export async function searchFoods(
  userId: string,
  keywords: string[],
  options: { limit?: number } = {},
  log?: Logger,
): Promise<CommonFood[]> {
  const l = log ?? logger;
  const db = getDb();
  const limit = options.limit ?? 10;

  const conditions = [eq(customFoods.userId, userId)];

  if (process.env.FITBIT_DRY_RUN !== "true") {
    conditions.push(isNotNull(customFoods.fitbitFoodId));
  }

  const rows = await db
    .select()
    .from(customFoods)
    .leftJoin(foodLogEntries, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(and(...conditions));

  // Application-level filtering: keyword match ratio OR food name substring match
  const filtered = rows.filter((row) => {
    // Primary: keyword-based matching (ratio >= 0.5)
    const existingKeywords = row.custom_foods.keywords;
    if (existingKeywords && existingKeywords.length > 0) {
      // Normalize existing keywords to lowercase — DB keywords may have mixed case
      // if the model didn't follow the "lowercase tokens" instruction perfectly
      const normalizedExisting = existingKeywords.map(k => k.toLowerCase());
      if (computeMatchRatio(keywords, normalizedExisting) >= 0.5) return true;
    }

    // Fallback: all search terms appear as substrings in the food name.
    // This catches brand names (excluded from keywords) and partial words.
    const foodNameLower = row.custom_foods.foodName.toLowerCase();
    return keywords.every(kw => foodNameLower.includes(kw));
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

  const results = sorted.map(({ row, bestEntry }) => {
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
      saturatedFatG: row.custom_foods.saturatedFatG != null ? Number(row.custom_foods.saturatedFatG) : null,
      transFatG: row.custom_foods.transFatG != null ? Number(row.custom_foods.transFatG) : null,
      sugarsG: row.custom_foods.sugarsG != null ? Number(row.custom_foods.sugarsG) : null,
      caloriesFromFat: row.custom_foods.caloriesFromFat != null ? Number(row.custom_foods.caloriesFromFat) : null,
      fitbitFoodId: row.custom_foods.fitbitFoodId ?? null,
      mealTypeId: entryRow.food_log_entries?.mealTypeId ?? 7,
      isFavorite: row.custom_foods.isFavorite,
    };
  });
  l.debug({ action: "search_foods", keywords, resultCount: results.length }, "food search complete");
  return results;
}

export interface CustomFoodMetadataUpdate {
  description?: string | null;
  notes?: string | null;
  keywords?: string[] | null;
  confidence?: "high" | "medium" | "low";
}

export async function updateCustomFoodMetadata(
  userId: string,
  customFoodId: number,
  metadata: CustomFoodMetadataUpdate,
): Promise<void> {
  const db = getDb();

  // Only include fields that are present in the metadata object
  const updateFields: Partial<{
    description: string | null;
    notes: string | null;
    keywords: string[] | null;
    confidence: "high" | "medium" | "low";
  }> = {};

  if ("description" in metadata) {
    updateFields.description = metadata.description;
  }
  if ("notes" in metadata) {
    updateFields.notes = metadata.notes;
  }
  if ("keywords" in metadata) {
    updateFields.keywords = metadata.keywords;
  }
  if ("confidence" in metadata) {
    updateFields.confidence = metadata.confidence;
  }

  // If no fields to update, return early
  if (Object.keys(updateFields).length === 0) {
    return;
  }

  await db
    .update(customFoods)
    .set(updateFields)
    .where(and(eq(customFoods.id, customFoodId), eq(customFoods.userId, userId)));
}

export async function getEarliestEntryDate(
  userId: string,
  log?: Logger,
): Promise<string | null> {
  const l = log ?? logger;
  const db = getDb();

  const rows = await db
    .select({ date: foodLogEntries.date })
    .from(foodLogEntries)
    .where(eq(foodLogEntries.userId, userId))
    .orderBy(asc(foodLogEntries.date))
    .limit(1);

  const date = rows[0]?.date ?? null;
  l.debug({ action: "get_earliest_entry_date", hasDate: date !== null }, "earliest entry date retrieved");
  return date;
}

export async function getDailyNutritionSummary(
  userId: string,
  date: string,
  log?: Logger,
): Promise<import("@/types").NutritionSummary> {
  const l = log ?? logger;
  const db = getDb();

  const rows = await db
    .select()
    .from(foodLogEntries)
    .innerJoin(customFoods, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(and(eq(foodLogEntries.userId, userId), eq(foodLogEntries.date, date)))
    .orderBy(asc(foodLogEntries.mealTypeId), asc(foodLogEntries.time), asc(foodLogEntries.id));

  // Group entries by mealTypeId
  const mealGroups = new Map<number, typeof rows>();
  for (const row of rows) {
    const mealTypeId = row.food_log_entries.mealTypeId;
    const existing = mealGroups.get(mealTypeId);
    if (!existing) {
      mealGroups.set(mealTypeId, [row]);
    } else {
      existing.push(row);
    }
  }

  // Calculate totals and per-meal subtotals
  const meals: import("@/types").MealGroup[] = [];
  let totalCalories = 0;
  let totalProteinG = 0;
  let totalCarbsG = 0;
  let totalFatG = 0;
  let totalFiberG = 0;
  let totalSodiumMg = 0;
  let totalSaturatedFatG = 0;
  let totalTransFatG = 0;
  let totalSugarsG = 0;
  let totalCaloriesFromFat = 0;

  for (const [mealTypeId, mealRows] of mealGroups) {
    const entries: import("@/types").MealEntry[] = [];
    let mealCalories = 0;
    let mealProteinG = 0;
    let mealCarbsG = 0;
    let mealFatG = 0;
    let mealFiberG = 0;
    let mealSodiumMg = 0;
    let mealSaturatedFatG = 0;
    let mealTransFatG = 0;
    let mealSugarsG = 0;
    let mealCaloriesFromFat = 0;

    for (const row of mealRows) {
      const calories = row.custom_foods.calories;
      const proteinG = Number(row.custom_foods.proteinG);
      const carbsG = Number(row.custom_foods.carbsG);
      const fatG = Number(row.custom_foods.fatG);
      const fiberG = Number(row.custom_foods.fiberG);
      const sodiumMg = Number(row.custom_foods.sodiumMg);
      const saturatedFatG = row.custom_foods.saturatedFatG != null ? Number(row.custom_foods.saturatedFatG) : 0;
      const transFatG = row.custom_foods.transFatG != null ? Number(row.custom_foods.transFatG) : 0;
      const sugarsG = row.custom_foods.sugarsG != null ? Number(row.custom_foods.sugarsG) : 0;
      const caloriesFromFat = row.custom_foods.caloriesFromFat != null ? Number(row.custom_foods.caloriesFromFat) : 0;

      entries.push({
        id: row.food_log_entries.id,
        customFoodId: row.custom_foods.id,
        foodName: row.custom_foods.foodName,
        time: row.food_log_entries.time,
        calories,
        proteinG,
        carbsG,
        fatG,
        fiberG,
        sodiumMg,
        saturatedFatG: row.custom_foods.saturatedFatG != null ? Number(row.custom_foods.saturatedFatG) : null,
        transFatG: row.custom_foods.transFatG != null ? Number(row.custom_foods.transFatG) : null,
        sugarsG: row.custom_foods.sugarsG != null ? Number(row.custom_foods.sugarsG) : null,
        caloriesFromFat: row.custom_foods.caloriesFromFat != null ? Number(row.custom_foods.caloriesFromFat) : null,
      });

      mealCalories += calories;
      mealProteinG += proteinG;
      mealCarbsG += carbsG;
      mealFatG += fatG;
      mealFiberG += fiberG;
      mealSodiumMg += sodiumMg;
      mealSaturatedFatG += saturatedFatG;
      mealTransFatG += transFatG;
      mealSugarsG += sugarsG;
      mealCaloriesFromFat += caloriesFromFat;
    }

    meals.push({
      mealTypeId,
      entries,
      subtotal: {
        calories: mealCalories,
        proteinG: mealProteinG,
        carbsG: mealCarbsG,
        fatG: mealFatG,
        fiberG: mealFiberG,
        sodiumMg: mealSodiumMg,
        saturatedFatG: mealSaturatedFatG,
        transFatG: mealTransFatG,
        sugarsG: mealSugarsG,
        caloriesFromFat: mealCaloriesFromFat,
      },
    });

    totalCalories += mealCalories;
    totalProteinG += mealProteinG;
    totalCarbsG += mealCarbsG;
    totalFatG += mealFatG;
    totalFiberG += mealFiberG;
    totalSodiumMg += mealSodiumMg;
    totalSaturatedFatG += mealSaturatedFatG;
    totalTransFatG += mealTransFatG;
    totalSugarsG += mealSugarsG;
    totalCaloriesFromFat += mealCaloriesFromFat;
  }

  l.debug({ action: "get_daily_nutrition_summary", date, mealCount: meals.length, totalCalories }, "daily nutrition summary computed");
  return {
    date,
    meals,
    totals: {
      calories: totalCalories,
      proteinG: totalProteinG,
      carbsG: totalCarbsG,
      fatG: totalFatG,
      fiberG: totalFiberG,
      sodiumMg: totalSodiumMg,
      saturatedFatG: totalSaturatedFatG,
      transFatG: totalTransFatG,
      sugarsG: totalSugarsG,
      caloriesFromFat: totalCaloriesFromFat,
    },
  };
}

export async function setShareToken(
  userId: string,
  customFoodId: number,
): Promise<string | null> {
  const db = getDb();

  // Check if food exists and already has a token
  const rows = await db
    .select()
    .from(customFoods)
    .where(and(eq(customFoods.id, customFoodId), eq(customFoods.userId, userId)));

  const food = rows[0];
  if (!food) return null;

  if (food.shareToken) return food.shareToken;

  // Atomic: only set token if still null (prevents race condition)
  const token = nanoid(12);
  await db
    .update(customFoods)
    .set({ shareToken: token })
    .where(and(
      eq(customFoods.id, customFoodId),
      eq(customFoods.userId, userId),
      isNull(customFoods.shareToken),
    ));

  // Re-read to get the winner's token (handles concurrent race)
  const refetch = await db
    .select({ shareToken: customFoods.shareToken })
    .from(customFoods)
    .where(and(eq(customFoods.id, customFoodId), eq(customFoods.userId, userId)));

  return refetch[0]?.shareToken ?? null;
}

export async function getCustomFoodByShareToken(shareToken: string) {
  const db = getDb();

  const rows = await db
    .select()
    .from(customFoods)
    .where(eq(customFoods.shareToken, shareToken));

  return rows[0] ?? null;
}

export async function getDateRangeNutritionSummary(
  userId: string,
  fromDate: string,
  toDate: string,
  log?: Logger,
): Promise<DailyNutritionTotals[]> {
  const l = log ?? logger;
  const db = getDb();

  // Query all food log entries in the date range
  const rows = await db
    .select()
    .from(foodLogEntries)
    .innerJoin(customFoods, eq(foodLogEntries.customFoodId, customFoods.id))
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        between(foodLogEntries.date, fromDate, toDate)
      )
    )
    .orderBy(asc(foodLogEntries.date));

  // Group by date and aggregate nutrition totals
  const dailyTotals = new Map<string, Omit<DailyNutritionTotals, "calorieGoal" | "proteinGoalG" | "carbsGoalG" | "fatGoalG">>();

  for (const row of rows) {
    const date = row.food_log_entries.date;
    const existing = dailyTotals.get(date);

    const calories = row.custom_foods.calories;
    const proteinG = Number(row.custom_foods.proteinG);
    const carbsG = Number(row.custom_foods.carbsG);
    const fatG = Number(row.custom_foods.fatG);
    const fiberG = Number(row.custom_foods.fiberG);
    const sodiumMg = Number(row.custom_foods.sodiumMg);

    if (!existing) {
      dailyTotals.set(date, {
        date,
        calories,
        proteinG,
        carbsG,
        fatG,
        fiberG,
        sodiumMg,
      });
    } else {
      existing.calories += calories;
      existing.proteinG += proteinG;
      existing.carbsG += carbsG;
      existing.fatG += fatG;
      existing.fiberG += fiberG;
      existing.sodiumMg += sodiumMg;
    }
  }

  // Get calorie goals and lumen goals for the date range
  const [calorieGoals, lumenGoals] = await Promise.all([
    getCalorieGoalsByDateRange(userId, fromDate, toDate),
    getLumenGoalsByDateRange(userId, fromDate, toDate),
  ]);

  const calorieGoalsByDate = new Map(calorieGoals.map(g => [g.date, g.calorieGoal]));
  const macroGoalsByDate = new Map(
    lumenGoals.map(g => [g.date, { proteinGoal: g.proteinGoal, carbsGoal: g.carbsGoal, fatGoal: g.fatGoal }])
  );

  // Merge nutrition totals with calorie goals and macro goals
  const result: DailyNutritionTotals[] = [];
  for (const [date, totals] of dailyTotals) {
    result.push({
      ...totals,
      calorieGoal: calorieGoalsByDate.get(date) ?? null,
      proteinGoalG: macroGoalsByDate.get(date)?.proteinGoal ?? null,
      carbsGoalG: macroGoalsByDate.get(date)?.carbsGoal ?? null,
      fatGoalG: macroGoalsByDate.get(date)?.fatGoal ?? null,
    });
  }

  // Sort by date ascending (already in order from query, but ensure consistency)
  result.sort((a, b) => a.date.localeCompare(b.date));

  l.debug({ action: "get_date_range_nutrition_summary", fromDate, toDate, dayCount: result.length }, "date range nutrition summary computed");
  return result;
}
