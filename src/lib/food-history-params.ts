import { isValidDateFormat } from "@/lib/date-utils";

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const POSITIVE_INT_REGEX = /^\d{1,10}$/;
const INT4_MAX = 2147483647;

export interface FoodHistoryParams {
  endDate: string | undefined;
  cursor: { lastDate: string; lastTime: string | null; lastId: number } | undefined;
}

/**
 * Strictly parses an id query value: digits only, 1..int4 max. `parseInt` would accept "12abc"
 * as 12 and let values beyond the int4 serial range reach Postgres (500).
 */
export function parseStrictId(value: string): number | null {
  if (!POSITIVE_INT_REGEX.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= INT4_MAX ? n : null;
}

/**
 * Parses endDate / lastDate / lastTime / lastId for the food-history routes. Empty values are
 * treated as absent; malformed or inconsistent values are reported (callers return 400) instead
 * of being silently dropped or reaching the database.
 */
export function parseFoodHistoryParams(searchParams: URLSearchParams): FoodHistoryParams | { error: string } {
  const endDate = searchParams.get("endDate") || undefined;
  if (endDate !== undefined && !isValidDateFormat(endDate)) {
    return { error: "Invalid endDate. Use a real calendar date in YYYY-MM-DD format" };
  }

  const lastDate = searchParams.get("lastDate") || null;
  const lastTime = searchParams.get("lastTime") || null;
  const lastIdParam = searchParams.get("lastId") || null;

  if (lastDate === null && lastIdParam === null) {
    if (lastTime !== null) return { error: "lastTime requires lastDate and lastId" };
    return { endDate, cursor: undefined };
  }
  if (lastDate === null || lastIdParam === null) {
    return { error: "lastDate and lastId must be provided together" };
  }
  if (!isValidDateFormat(lastDate)) {
    return { error: "Invalid lastDate. Use a real calendar date in YYYY-MM-DD format" };
  }
  if (lastTime !== null && !TIME_REGEX.test(lastTime)) {
    return { error: "Invalid lastTime. Use HH:mm:ss" };
  }
  const lastId = parseStrictId(lastIdParam);
  if (lastId === null) {
    return { error: "Invalid lastId. Must be a positive integer" };
  }

  return { endDate, cursor: { lastDate, lastTime, lastId } };
}
