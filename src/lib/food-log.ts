import { eq, and, or, isNull, gte, lte, lt, gt, desc, asc, between, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "@/db/index";
import { customFoods, foodLogEntries } from "@/db/schema";
import { computeMatchRatio } from "@/lib/food-matching";
import type { CommonFood, CommonFoodsCursor, CommonFoodsResponse, RecentFoodsCursor, RecentFoodsResponse, FoodLogHistoryEntry, FoodLogEntryDetail, DailyNutritionTotals, ServingUnit } from "@/types";
import { coerceServingUnit } from "@/types";
import { getDailyGoalsByDateRange } from "@/lib/nutrition-goals";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

export interface CustomFoodInput {
  foodName: string;
  amount: number;
  unitId: ServingUnit;
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
}

export interface FoodLogEntryInput {
  customFoodId: number;
  mealTypeId: number;
  amount: number;
  unitId: ServingUnit;
  date: string;
  time: string;
  zoneOffset?: string | null;
  healthLogId?: string | null;
}

export interface UpdateFoodLogInput {
  foodName: string;
  amount: number;
  unitId: ServingUnit;
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
  zoneOffset?: string | null;
  healthLogId?: string | null;
}

/**
 * Build the shared Drizzle insert-values object for a custom food row.
 * Stringifies numeric fields, Math.rounds calories, and nulls absent tier-1 nutrients.
 * Callers may spread additional fields (e.g. isFavorite, shareToken) on top.
 */
export function toCustomFoodInsertValues(data: CustomFoodInput) {
  return {
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
  };
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
    .values({ userId, ...toCustomFoodInsertValues(data) })
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
      zoneOffset: data.zoneOffset ?? null,
      healthLogId: data.healthLogId ?? null,
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
    unitId: string;
    date: string;
    time: string;
    healthLogId: string | null;
    loggedAt: Date;
  };
  custom_foods: {
    id: number;
    userId: string;
    foodName: string;
    amount: string;
    unitId: string;
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
    unitId: coerceServingUnit(row.custom_foods.unitId),
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
      // +1 safely exceeds any single non-favorite's totalScore (sentinel always passes `< cursorScore`).
      // id: 0 is safe because PostgreSQL serial PKs start at 1, so no real food has id 0.
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
    unitId: coerceServingUnit(row.food_log_entries.unitId),
    mealTypeId: row.food_log_entries.mealTypeId,
    date: row.food_log_entries.date,
    time: row.food_log_entries.time,
    healthLogId: row.food_log_entries.healthLogId,
    isFavorite: row.custom_foods.isFavorite,
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
    unitId: coerceServingUnit(row.food_log_entries.unitId),
    mealTypeId: row.food_log_entries.mealTypeId,
    date: row.food_log_entries.date,
    time: row.food_log_entries.time,
    healthLogId: row.food_log_entries.healthLogId,
    confidence: row.custom_foods.confidence,
    isFavorite: row.custom_foods.isFavorite,
    keywords: row.custom_foods.keywords ?? [],
  };
}

export interface FoodLogEntryMetadataUpdate {
  mealTypeId: number;
  date: string;
  time: string;
  healthLogId: string | null;
  zoneOffset?: string | null;
}

export async function updateFoodLogEntryMetadata(
  userId: string,
  entryId: number,
  updates: FoodLogEntryMetadataUpdate,
  log?: Logger,
): Promise<void> {
  const l = log ?? logger;
  const db = getDb();

  await db
    .update(foodLogEntries)
    .set({
      mealTypeId: updates.mealTypeId,
      date: updates.date,
      time: updates.time,
      healthLogId: updates.healthLogId,
      ...(updates.zoneOffset !== undefined ? { zoneOffset: updates.zoneOffset } : {}),
    })
    .where(and(eq(foodLogEntries.id, entryId), eq(foodLogEntries.userId, userId)));

  l.debug({ action: "update_food_log_entry_metadata", entryId }, "food log entry metadata updated");
}

type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export interface InsertCustomFoodWithLogEntryResult {
  customFoodId: number;
  foodLogId: number;
}

export async function insertCustomFoodWithLogEntry(
  userId: string,
  customFoodData: CustomFoodInput,
  logEntryData: Omit<FoodLogEntryInput, "customFoodId">,
  log?: Logger,
): Promise<InsertCustomFoodWithLogEntryResult> {
  const l = log ?? logger;
  const db = getDb();

  return db.transaction(async (tx) => {
    const foodRows = await tx
      .insert(customFoods)
      .values({ userId, ...toCustomFoodInsertValues(customFoodData) })
      .returning({ id: customFoods.id, createdAt: customFoods.createdAt });

    const foodRow = foodRows[0];
    if (!foodRow) throw new Error("Failed to insert custom food: no row returned");

    const entryRows = await tx
      .insert(foodLogEntries)
      .values({
        userId,
        customFoodId: foodRow.id,
        mealTypeId: logEntryData.mealTypeId,
        amount: String(logEntryData.amount),
        unitId: logEntryData.unitId,
        date: logEntryData.date,
        time: logEntryData.time,
        zoneOffset: logEntryData.zoneOffset ?? null,
        healthLogId: logEntryData.healthLogId ?? null,
      })
      .returning({ id: foodLogEntries.id, loggedAt: foodLogEntries.loggedAt });

    const entryRow = entryRows[0];
    if (!entryRow) throw new Error("Failed to insert food log entry: no row returned");

    l.debug(
      { action: "insert_custom_food_with_log_entry", foodName: customFoodData.foodName, customFoodId: foodRow.id, foodLogId: entryRow.id },
      "custom food and log entry inserted in transaction",
    );
    return { customFoodId: foodRow.id, foodLogId: entryRow.id };
  });
}

async function cleanupOrphanCustomFood(tx: DbTx, customFoodId: number, userId: string): Promise<boolean> {
  const remainingEntries = await tx
    .select({ id: foodLogEntries.id })
    .from(foodLogEntries)
    .where(eq(foodLogEntries.customFoodId, customFoodId));

  if (remainingEntries.length === 0) {
    await tx
      .delete(customFoods)
      .where(and(eq(customFoods.id, customFoodId), eq(customFoods.userId, userId)));
    return true;
  }
  return false;
}

export async function deleteFoodLogEntry(
  userId: string,
  entryId: number,
  log?: Logger,
): Promise<{ healthLogId: string | null } | null> {
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
        healthLogId: foodLogEntries.healthLogId,
        customFoodId: foodLogEntries.customFoodId,
      });

    const row = rows[0];
    if (!row) return null;

    const orphanedFoodCleaned = await cleanupOrphanCustomFood(tx, row.customFoodId, userId);

    l.debug({ action: "delete_food_log_entry", entryId, orphanedFoodCleaned }, "food log entry deleted");
    return { healthLogId: row.healthLogId };
  });
}

export async function updateFoodLogEntry(
  userId: string,
  entryId: number,
  data: UpdateFoodLogInput,
  log?: Logger,
): Promise<{ healthLogId: string | null; newCustomFoodId: number } | null> {
  const l = log ?? logger;
  const db = getDb();

  return db.transaction(async (tx) => {
    // Fetch current entry to get customFoodId and healthLogId
    const rows = await tx
      .select({
        customFoodId: foodLogEntries.customFoodId,
        healthLogId: foodLogEntries.healthLogId,
      })
      .from(foodLogEntries)
      .where(and(eq(foodLogEntries.id, entryId), eq(foodLogEntries.userId, userId)));

    const row = rows[0];
    if (!row) return null;

    const oldCustomFoodId = row.customFoodId;

    // Fetch metadata from old custom food to preserve during replacement
    const oldFoodRows = await tx
      .select({
        isFavorite: customFoods.isFavorite,
        shareToken: customFoods.shareToken,
      })
      .from(customFoods)
      .where(and(eq(customFoods.id, oldCustomFoodId), eq(customFoods.userId, userId)));
    const oldFood = oldFoodRows[0];

    // Clear shareToken on old food before inserting new one to avoid unique constraint violation
    if (oldFood?.shareToken) {
      await tx
        .update(customFoods)
        .set({ shareToken: null })
        .where(and(eq(customFoods.id, oldCustomFoodId), eq(customFoods.userId, userId)));
    }

    // Insert new custom food with updated values, preserving metadata from old record
    const newFoods = await tx
      .insert(customFoods)
      .values({
        userId,
        ...toCustomFoodInsertValues(data),
        // Preserve metadata from old record (extras spread on top of base values)
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
        ...(data.zoneOffset !== undefined ? { zoneOffset: data.zoneOffset } : {}),
        ...(data.healthLogId !== undefined ? { healthLogId: data.healthLogId } : {}),
      })
      .where(and(eq(foodLogEntries.id, entryId), eq(foodLogEntries.userId, userId)));

    // Clean up old custom food if no longer referenced
    await cleanupOrphanCustomFood(tx, oldCustomFoodId, userId);

    l.debug({ action: "update_food_log_entry", entryId, newCustomFoodId: newFood.id }, "food log entry updated");
    return { healthLogId: data.healthLogId !== undefined ? data.healthLogId : row.healthLogId, newCustomFoodId: newFood.id };
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

  // Query 1: fetch all custom foods for this user (one row per food — no cross-join).
  const foods = await db
    .select()
    .from(customFoods)
    .where(eq(customFoods.userId, userId));

  // Application-level filtering: keyword match ratio OR food name substring match.
  // All user foods remain searchable — no limit applied before or during filtering
  // (see memory: "always show all logged foods").
  const filtered = foods.filter((food) => {
    // Primary: keyword-based matching (ratio >= 0.5)
    const existingKeywords = food.keywords;
    if (existingKeywords && existingKeywords.length > 0) {
      // Normalize existing keywords to lowercase — DB keywords may have mixed case
      // if the model didn't follow the "lowercase tokens" instruction perfectly
      const normalizedExisting = existingKeywords.map(k => k.toLowerCase());
      if (computeMatchRatio(keywords, normalizedExisting) >= 0.5) return true;
    }

    // Fallback: all search terms appear as substrings in the food name.
    // This catches brand names (excluded from keywords) and partial words.
    const foodNameLower = food.foodName.toLowerCase();
    return keywords.every(kw => foodNameLower.includes(kw));
  });

  if (filtered.length === 0) {
    l.debug({ action: "search_foods", keywords, resultCount: 0 }, "food search complete");
    return [];
  }

  // Query 2: fetch log entries only for the matched foods and aggregate per food.
  // Using a separate scoped query avoids materialising the full
  // custom_foods × food_log_entries cross-join AND avoids loading the user's entire
  // history — only entries for the filtered foods are fetched. Aggregation
  // (count, maxDate, bestMealTypeId) happens in memory.
  const filteredIds = new Set(filtered.map(f => f.id));
  const logRows = await db
    .select()
    .from(foodLogEntries)
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        inArray(foodLogEntries.customFoodId, [...filteredIds]),
      ),
    );

  // Aggregate log data per customFoodId: count entries, track latest date and its mealTypeId
  const aggregated = new Map<number, { count: number; maxDate: string | null; bestMealTypeId: number }>();

  for (const entry of logRows) {
    if (!filteredIds.has(entry.customFoodId)) continue;
    const existing = aggregated.get(entry.customFoodId);
    const entryDate = entry.date;
    if (!existing) {
      aggregated.set(entry.customFoodId, { count: 1, maxDate: entryDate, bestMealTypeId: entry.mealTypeId });
    } else {
      existing.count += 1;
      if (!existing.maxDate || entryDate > existing.maxDate) {
        existing.maxDate = entryDate;
        existing.bestMealTypeId = entry.mealTypeId;
      }
    }
  }

  // Sort by count DESC, then maxDate DESC
  const sorted = [...filtered]
    .sort((a, b) => {
      const aggA = aggregated.get(a.id);
      const aggB = aggregated.get(b.id);
      const countA = aggA?.count ?? 0;
      const countB = aggB?.count ?? 0;
      if (countB !== countA) return countB - countA;
      const dateA = aggA?.maxDate ?? "";
      const dateB = aggB?.maxDate ?? "";
      return dateB.localeCompare(dateA);
    })
    .slice(0, limit);

  const results = sorted.map(food => {
    const agg = aggregated.get(food.id);
    return {
      customFoodId: food.id,
      foodName: food.foodName,
      amount: Number(food.amount),
      unitId: coerceServingUnit(food.unitId),
      calories: food.calories,
      proteinG: Number(food.proteinG),
      carbsG: Number(food.carbsG),
      fatG: Number(food.fatG),
      fiberG: Number(food.fiberG),
      sodiumMg: Number(food.sodiumMg),
      saturatedFatG: food.saturatedFatG != null ? Number(food.saturatedFatG) : null,
      transFatG: food.transFatG != null ? Number(food.transFatG) : null,
      sugarsG: food.sugarsG != null ? Number(food.sugarsG) : null,
      caloriesFromFat: food.caloriesFromFat != null ? Number(food.caloriesFromFat) : null,
      mealTypeId: agg?.bestMealTypeId ?? 7,
      isFavorite: food.isFavorite,
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
  log?: Logger,
): Promise<void> {
  const l = log ?? logger;
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
    l.debug({ action: "update_custom_food_metadata", customFoodId, userId }, "no fields to update, skipping");
    return;
  }

  await db
    .update(customFoods)
    .set(updateFields)
    .where(and(eq(customFoods.id, customFoodId), eq(customFoods.userId, userId)));

  l.debug({ action: "update_custom_food_metadata", customFoodId, userId }, "custom food metadata updated");
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
        zoneOffset: row.food_log_entries.zoneOffset ?? null,
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
        amount: Number(row.food_log_entries.amount),
        unitId: coerceServingUnit(row.food_log_entries.unitId),
        isFavorite: row.custom_foods.isFavorite,
        healthLogId: row.food_log_entries.healthLogId,
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

/**
 * Revoke the share token for a custom food owned by the given user.
 * Sets shareToken to null, scoped by id + userId to prevent cross-user revocation.
 */
export async function revokeShareToken(id: number, userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(customFoods)
    .set({ shareToken: null })
    .where(and(eq(customFoods.id, id), eq(customFoods.userId, userId)));
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

  // Get daily goals (calorie + macro) for the date range from daily_calorie_goals
  const dailyGoals = await getDailyGoalsByDateRange(userId, fromDate, toDate);

  const goalsByDate = new Map(
    dailyGoals.map(g => [g.date, { calorieGoal: g.calorieGoal, proteinGoal: g.proteinGoal, carbsGoal: g.carbsGoal, fatGoal: g.fatGoal }])
  );

  // Merge nutrition totals with goals
  const result: DailyNutritionTotals[] = [];
  for (const [date, totals] of dailyTotals) {
    const goals = goalsByDate.get(date);
    result.push({
      ...totals,
      calorieGoal: goals?.calorieGoal ?? null,
      proteinGoalG: goals?.proteinGoal ?? null,
      carbsGoalG: goals?.carbsGoal ?? null,
      fatGoalG: goals?.fatGoal ?? null,
    });
  }

  // Sort by date ascending (already in order from query, but ensure consistency)
  result.sort((a, b) => a.date.localeCompare(b.date));

  l.debug({ action: "get_date_range_nutrition_summary", fromDate, toDate, dayCount: result.length }, "date range nutrition summary computed");
  return result;
}
