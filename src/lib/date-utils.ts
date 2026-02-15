/**
 * Utility functions for date manipulation and formatting.
 * All dates are handled in YYYY-MM-DD format.
 */

/**
 * Get today's date in YYYY-MM-DD format.
 * Uses the runtime's local timezone (browser timezone on client,
 * server timezone on server).
 */
export function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a date string for display.
 * Returns "Today" for today, "Yesterday" for yesterday,
 * or "Ddd, Mmm D" format for other dates (e.g., "Mon, Feb 10").
 */
export function formatDisplayDate(dateStr: string): string {
  const today = getTodayDate();

  if (dateStr === today) {
    return "Today";
  }

  // Check if yesterday
  const yesterday = addDays(today, -1);
  if (dateStr === yesterday) {
    return "Yesterday";
  }

  // Format as "Ddd, Mmm D"
  const date = new Date(`${dateStr}T00:00:00Z`);
  const dayName = date.toLocaleString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  const monthName = date.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const dayOfMonth = date.getUTCDate();

  return `${dayName}, ${monthName} ${dayOfMonth}`;
}

/**
 * Add days to a date string.
 * Positive numbers add days, negative numbers subtract days.
 * Returns result in YYYY-MM-DD format.
 */
export function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Check if a date string represents today.
 */
export function isToday(dateStr: string): boolean {
  return dateStr === getTodayDate();
}

/**
 * Get the week bounds (Sunday to Saturday) for a given date.
 * Returns the Sunday (start) and Saturday (end) of the week containing the given date.
 */
export function getWeekBounds(dateStr: string): { start: string; end: string } {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 6 = Saturday

  // Calculate Sunday (start of week)
  const start = addDays(dateStr, -dayOfWeek);

  // Calculate Saturday (end of week)
  const end = addDays(dateStr, 6 - dayOfWeek);

  return { start, end };
}

/**
 * Format a week range for display.
 * Returns "Mon D – D" if both dates are in the same month,
 * or "Mon D – Mon D" if they span different months.
 */
export function formatWeekRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);

  const startMonth = startDate.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const startDay = startDate.getUTCDate();

  const endMonth = endDate.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const endDay = endDate.getUTCDate();

  if (startMonth === endMonth) {
    // Same month: "Mon D – D"
    return `${startMonth} ${startDay} – ${endDay}`;
  } else {
    // Different months: "Mon D – Mon D"
    return `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
  }
}

/**
 * Add weeks to a date string.
 * Positive numbers add weeks, negative numbers subtract weeks.
 * Returns result in YYYY-MM-DD format.
 */
export function addWeeks(dateStr: string, weeks: number): string {
  return addDays(dateStr, weeks * 7);
}

/**
 * Validate that a date string is in YYYY-MM-DD format and represents a valid date.
 * Returns false for invalid formats, invalid months/days, or dates that don't exist (e.g., Feb 30).
 */
export function isValidDateFormat(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}
