import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTodayDate, formatDisplayDate, addDays, isToday, getWeekBounds, formatWeekRange, addWeeks, isValidDateFormat, formatTime, formatTimeFromDate } from "@/lib/date-utils";

describe("getTodayDate", () => {
  it("returns today's date in YYYY-MM-DD format", () => {
    const result = getTodayDate();
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    expect(result).toMatch(regex);

    // Verify it's actually today
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(result).toBe(expected);
  });

  it("pads month and day with leading zeros", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T12:00:00Z"));

    const result = getTodayDate();
    expect(result).toBe("2026-01-05");

    vi.useRealTimers();
  });
});

describe("formatDisplayDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'Today' for today's date", () => {
    vi.setSystemTime(new Date("2026-02-10T12:00:00Z"));
    const result = formatDisplayDate("2026-02-10");
    expect(result).toBe("Today");
  });

  it("returns 'Yesterday' for yesterday's date", () => {
    vi.setSystemTime(new Date("2026-02-10T12:00:00Z"));
    const result = formatDisplayDate("2026-02-09");
    expect(result).toBe("Yesterday");
  });

  it("returns formatted date for other dates", () => {
    vi.setSystemTime(new Date("2026-02-10T12:00:00Z"));
    const result = formatDisplayDate("2026-02-08");
    // Should return a readable format like "Sat, Feb 8"
    expect(result).toMatch(/^[A-Za-z]{3}, [A-Za-z]{3} \d{1,2}$/);
  });

  it("formats date without leading zero for day", () => {
    vi.setSystemTime(new Date("2026-02-10T12:00:00Z"));
    const result = formatDisplayDate("2026-02-05");
    expect(result).toBe("Thu, Feb 5");
  });

  it("formats date with double-digit day", () => {
    vi.setSystemTime(new Date("2026-02-15T12:00:00Z"));
    const result = formatDisplayDate("2026-02-10");
    expect(result).toBe("Tue, Feb 10");
  });
});

describe("addDays", () => {
  it("adds positive days to a date", () => {
    const result = addDays("2026-02-10", 5);
    expect(result).toBe("2026-02-15");
  });

  it("adds negative days to a date (subtracts)", () => {
    const result = addDays("2026-02-10", -5);
    expect(result).toBe("2026-02-05");
  });

  it("handles month boundary", () => {
    const result = addDays("2026-02-28", 1);
    expect(result).toBe("2026-03-01");
  });

  it("handles year boundary", () => {
    const result = addDays("2025-12-31", 1);
    expect(result).toBe("2026-01-01");
  });

  it("returns same date when adding 0 days", () => {
    const result = addDays("2026-02-10", 0);
    expect(result).toBe("2026-02-10");
  });
});

describe("isToday", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for today's date", () => {
    vi.setSystemTime(new Date("2026-02-10T12:00:00Z"));
    const result = isToday("2026-02-10");
    expect(result).toBe(true);
  });

  it("returns false for yesterday", () => {
    vi.setSystemTime(new Date("2026-02-10T12:00:00Z"));
    const result = isToday("2026-02-09");
    expect(result).toBe(false);
  });

  it("returns false for tomorrow", () => {
    vi.setSystemTime(new Date("2026-02-10T12:00:00Z"));
    const result = isToday("2026-02-11");
    expect(result).toBe(false);
  });
});

describe("getWeekBounds", () => {
  it("returns Sunday-Saturday bounds for a date in the middle of the week", () => {
    // Wednesday Feb 12, 2026 should return Sunday Feb 8 - Saturday Feb 14
    const result = getWeekBounds("2026-02-12");
    expect(result).toEqual({
      start: "2026-02-08",
      end: "2026-02-14",
    });
  });

  it("returns same Sunday when date is already Sunday", () => {
    // Sunday Feb 8, 2026
    const result = getWeekBounds("2026-02-08");
    expect(result).toEqual({
      start: "2026-02-08",
      end: "2026-02-14",
    });
  });

  it("returns correct Sunday when date is Saturday", () => {
    // Saturday Feb 14, 2026 should return Sunday Feb 8 - Saturday Feb 14
    const result = getWeekBounds("2026-02-14");
    expect(result).toEqual({
      start: "2026-02-08",
      end: "2026-02-14",
    });
  });

  it("handles week boundaries across months", () => {
    // Monday Mar 2, 2026 should return Sunday Mar 1 - Saturday Mar 7
    const result = getWeekBounds("2026-03-02");
    expect(result).toEqual({
      start: "2026-03-01",
      end: "2026-03-07",
    });
  });

  it("handles week boundaries across years", () => {
    // Wednesday Jan 1, 2026 should return Sunday Dec 28, 2025 - Saturday Jan 3, 2026
    const result = getWeekBounds("2026-01-01");
    expect(result).toEqual({
      start: "2025-12-28",
      end: "2026-01-03",
    });
  });
});

describe("formatWeekRange", () => {
  it("formats range within same month as 'Mon D – D'", () => {
    // Feb 8 - Feb 14, 2026 (both February)
    const result = formatWeekRange("2026-02-08", "2026-02-14");
    expect(result).toBe("Feb 8 – 14");
  });

  it("formats range across different months as 'Mon D – Mon D'", () => {
    // Feb 23 - Mar 1, 2026
    const result = formatWeekRange("2026-02-23", "2026-03-01");
    expect(result).toBe("Feb 23 – Mar 1");
  });

  it("formats range across years as 'Mon D – Mon D'", () => {
    // Dec 28, 2025 - Jan 3, 2026
    const result = formatWeekRange("2025-12-28", "2026-01-03");
    expect(result).toBe("Dec 28 – Jan 3");
  });

  it("handles single-digit days correctly", () => {
    // Mar 1 - Mar 7, 2026
    const result = formatWeekRange("2026-03-01", "2026-03-07");
    expect(result).toBe("Mar 1 – 7");
  });
});

describe("addWeeks", () => {
  it("adds positive weeks to a date", () => {
    // Feb 10, 2026 + 2 weeks = Feb 24, 2026
    const result = addWeeks("2026-02-10", 2);
    expect(result).toBe("2026-02-24");
  });

  it("adds negative weeks to a date (subtracts)", () => {
    // Feb 24, 2026 - 2 weeks = Feb 10, 2026
    const result = addWeeks("2026-02-24", -2);
    expect(result).toBe("2026-02-10");
  });

  it("handles month boundary", () => {
    // Feb 28, 2026 + 1 week = Mar 7, 2026
    const result = addWeeks("2026-02-28", 1);
    expect(result).toBe("2026-03-07");
  });

  it("handles year boundary", () => {
    // Dec 28, 2025 + 1 week = Jan 4, 2026
    const result = addWeeks("2025-12-28", 1);
    expect(result).toBe("2026-01-04");
  });

  it("returns same date when adding 0 weeks", () => {
    const result = addWeeks("2026-02-10", 0);
    expect(result).toBe("2026-02-10");
  });
});

describe("isValidDateFormat", () => {
  it("returns true for valid date", () => {
    const result = isValidDateFormat("2026-02-14");
    expect(result).toBe(true);
  });

  it("returns false for invalid month", () => {
    const result = isValidDateFormat("2026-13-01");
    expect(result).toBe(false);
  });

  it("returns false for invalid day (Feb 30 doesn't exist)", () => {
    const result = isValidDateFormat("2026-02-30");
    expect(result).toBe(false);
  });

  it("returns false for non-date string", () => {
    const result = isValidDateFormat("not-a-date");
    expect(result).toBe(false);
  });

  it("returns false for invalid format (wrong separator)", () => {
    const result = isValidDateFormat("2026/02/14");
    expect(result).toBe(false);
  });

  it("returns false for incomplete date", () => {
    const result = isValidDateFormat("2026-02");
    expect(result).toBe(false);
  });

  it("returns true for leap year Feb 29", () => {
    const result = isValidDateFormat("2024-02-29");
    expect(result).toBe(true);
  });

  it("returns false for non-leap year Feb 29", () => {
    const result = isValidDateFormat("2026-02-29");
    expect(result).toBe(false);
  });

  it("returns false for day 32", () => {
    const result = isValidDateFormat("2026-01-32");
    expect(result).toBe(false);
  });

  it("returns false for month 0", () => {
    const result = isValidDateFormat("2026-00-15");
    expect(result).toBe(false);
  });

  it("returns false for day 0", () => {
    const result = isValidDateFormat("2026-02-00");
    expect(result).toBe(false);
  });
});

describe("formatTime", () => {
  it("returns HH:MM unchanged for already-24h time", () => {
    expect(formatTime("14:30")).toBe("14:30");
  });

  it("preserves leading zero on hour", () => {
    expect(formatTime("09:05")).toBe("09:05");
  });

  it("handles midnight", () => {
    expect(formatTime("00:00")).toBe("00:00");
  });

  it("handles end of day", () => {
    expect(formatTime("23:59")).toBe("23:59");
  });

  it("returns empty string for null", () => {
    expect(formatTime(null)).toBe("");
  });

  it("strips seconds from HH:MM:SS", () => {
    expect(formatTime("14:30:00")).toBe("14:30");
  });
});

describe("formatTimeFromDate", () => {
  it("returns HH:MM in 24h format from a Date object", () => {
    const date = new Date(2026, 1, 5, 14, 30, 0); // Feb 5, 2026 14:30:00 local
    expect(formatTimeFromDate(date)).toBe("14:30");
  });

  it("pads hours and minutes with leading zeros", () => {
    const date = new Date(2026, 1, 5, 8, 5, 0); // Feb 5, 2026 08:05:00 local
    expect(formatTimeFromDate(date)).toBe("08:05");
  });

  it("handles midnight (00:00)", () => {
    const date = new Date(2026, 1, 5, 0, 0, 0); // Feb 5, 2026 00:00:00 local
    expect(formatTimeFromDate(date)).toBe("00:00");
  });

  it("handles end of day (23:59)", () => {
    const date = new Date(2026, 1, 5, 23, 59, 0); // Feb 5, 2026 23:59:00 local
    expect(formatTimeFromDate(date)).toBe("23:59");
  });
});
