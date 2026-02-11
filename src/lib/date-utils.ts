/**
 * Utility functions for date manipulation and formatting.
 * All dates are handled in YYYY-MM-DD format.
 */

/**
 * Get today's date in YYYY-MM-DD format.
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
