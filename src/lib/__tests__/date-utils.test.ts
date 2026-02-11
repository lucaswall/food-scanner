import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTodayDate, formatDisplayDate, addDays, isToday } from "@/lib/date-utils";

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
