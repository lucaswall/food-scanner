import { eq, and, gte, lte } from "drizzle-orm";
import { getDb } from "@/db/index";
import { foodLogEntries } from "@/db/schema";
import { addDays } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import type { FastingWindow } from "@/types";

/**
 * Convert HH:mm:ss time string to minutes since midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Get fasting window for a single date.
 * Returns the fasting duration from the last meal of the previous day
 * to the first meal of the current day.
 *
 * @param userId - User ID
 * @param date - Date in YYYY-MM-DD format
 * @returns FastingWindow or null if no previous day meal
 */
export async function getFastingWindow(
  userId: string,
  date: string,
  log?: Logger,
): Promise<FastingWindow | null> {
  const l = log ?? logger;
  const db = getDb();
  const previousDate = addDays(date, -1);

  // Query entries from previous day and current day
  const entries = await db
    .select({
      date: foodLogEntries.date,
      time: foodLogEntries.time,
    })
    .from(foodLogEntries)
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        gte(foodLogEntries.date, previousDate),
        lte(foodLogEntries.date, date)
      )
    );

  // Separate entries by date
  const previousDayEntries = entries.filter((e) => e.date === previousDate);
  const currentDayEntries = entries.filter((e) => e.date === date);

  // Need at least one meal from previous day
  if (previousDayEntries.length === 0) {
    l.debug({ action: "get_fasting_window", date, result: "no_previous_meals" }, "no previous day meals found");
    return null;
  }

  // Find MAX(time) from previous day (last meal)
  const lastMealTime = previousDayEntries.reduce((max, entry) => {
    return entry.time > max ? entry.time : max;
  }, previousDayEntries[0].time);

  // If no meals on current day, return ongoing fast
  if (currentDayEntries.length === 0) {
    l.debug({ action: "get_fasting_window", date, durationMinutes: null }, "ongoing fast (no meals today)");
    return {
      date,
      lastMealTime,
      firstMealTime: null,
      durationMinutes: null,
    };
  }

  // Find MIN(time) from current day (first meal)
  const firstMealTime = currentDayEntries.reduce((min, entry) => {
    return entry.time < min ? entry.time : min;
  }, currentDayEntries[0].time);

  // Calculate duration: firstMealMinutes + 1440 - lastMealMinutes
  const firstMealMinutes = parseTimeToMinutes(firstMealTime);
  const lastMealMinutes = parseTimeToMinutes(lastMealTime);
  const durationMinutes = firstMealMinutes + 1440 - lastMealMinutes;

  const result: FastingWindow = {
    date,
    lastMealTime,
    firstMealTime,
    durationMinutes,
  };
  l.debug({ action: "get_fasting_window", date, durationMinutes }, "fasting window computed");
  return result;
}

/**
 * Get fasting windows for a date range.
 * Returns one fasting window per date in the range.
 *
 * @param userId - User ID
 * @param fromDate - Start date in YYYY-MM-DD format (inclusive)
 * @param toDate - End date in YYYY-MM-DD format (inclusive)
 * @returns Array of FastingWindow objects (may be empty)
 */
export async function getFastingWindows(
  userId: string,
  fromDate: string,
  toDate: string,
  log?: Logger,
): Promise<FastingWindow[]> {
  const l = log ?? logger;
  const db = getDb();
  const previousDate = addDays(fromDate, -1);

  // Query all entries from (fromDate - 1) through toDate
  const entries = await db
    .select({
      date: foodLogEntries.date,
      time: foodLogEntries.time,
    })
    .from(foodLogEntries)
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        gte(foodLogEntries.date, previousDate),
        lte(foodLogEntries.date, toDate)
      )
    );

  if (entries.length === 0) {
    l.debug({ action: "get_fasting_windows", fromDate, toDate, windowCount: 0 }, "no entries in range");
    return [];
  }

  // Group entries by date
  const entriesByDate = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entriesByDate.has(entry.date)) {
      entriesByDate.set(entry.date, []);
    }
    entriesByDate.get(entry.date)!.push(entry.time);
  }

  // Generate fasting windows for each date in range
  const windows: FastingWindow[] = [];
  let currentDate = fromDate;

  while (currentDate <= toDate) {
    const prevDate = addDays(currentDate, -1);
    const prevDayTimes = entriesByDate.get(prevDate) || [];
    const currentDayTimes = entriesByDate.get(currentDate) || [];

    // Skip if no previous day meal
    if (prevDayTimes.length === 0) {
      currentDate = addDays(currentDate, 1);
      continue;
    }

    // Find MAX time from previous day
    const lastMealTime = prevDayTimes.reduce((max, time) => {
      return time > max ? time : max;
    });

    // If no meals on current day, ongoing fast
    if (currentDayTimes.length === 0) {
      windows.push({
        date: currentDate,
        lastMealTime,
        firstMealTime: null,
        durationMinutes: null,
      });
      currentDate = addDays(currentDate, 1);
      continue;
    }

    // Find MIN time from current day
    const firstMealTime = currentDayTimes.reduce((min, time) => {
      return time < min ? time : min;
    });

    // Calculate duration
    const firstMealMinutes = parseTimeToMinutes(firstMealTime);
    const lastMealMinutes = parseTimeToMinutes(lastMealTime);
    const durationMinutes = firstMealMinutes + 1440 - lastMealMinutes;

    windows.push({
      date: currentDate,
      lastMealTime,
      firstMealTime,
      durationMinutes,
    });

    currentDate = addDays(currentDate, 1);
  }

  l.debug({ action: "get_fasting_windows", fromDate, toDate, windowCount: windows.length }, "fasting windows computed");
  return windows;
}
