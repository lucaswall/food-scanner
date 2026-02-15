import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getDefaultMealType, getLocalDateTime } from "../meal-type";

describe("getDefaultMealType", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 1 (Breakfast) at 5:00", () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(5);
    expect(getDefaultMealType()).toBe(1);
  });

  it("returns 2 (Morning Snack) at 10:00", () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(10);
    expect(getDefaultMealType()).toBe(2);
  });

  it("returns 3 (Lunch) at 12:00", () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(12);
    expect(getDefaultMealType()).toBe(3);
  });

  it("returns 4 (Afternoon Snack) at 14:00", () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(14);
    expect(getDefaultMealType()).toBe(4);
  });

  it("returns 5 (Dinner) at 17:00", () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(17);
    expect(getDefaultMealType()).toBe(5);
  });

  it("returns 7 (Anytime) at 3:00", () => {
    vi.spyOn(Date.prototype, "getHours").mockReturnValue(3);
    expect(getDefaultMealType()).toBe(7);
  });
});

describe("getLocalDateTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns date in YYYY-MM-DD format", () => {
    vi.setSystemTime(new Date(2026, 1, 7, 14, 30, 45)); // Feb 7, 2026 14:30:45
    const result = getLocalDateTime();
    expect(result.date).toBe("2026-02-07");
  });

  it("returns time in HH:mm format (no seconds)", () => {
    vi.setSystemTime(new Date(2026, 1, 7, 14, 30, 45));
    const result = getLocalDateTime();
    expect(result.time).toBe("14:30");
  });

  it("zero-pads single-digit months, days, hours, minutes", () => {
    vi.setSystemTime(new Date(2026, 0, 3, 5, 7, 9)); // Jan 3, 2026 05:07:09
    const result = getLocalDateTime();
    expect(result.date).toBe("2026-01-03");
    expect(result.time).toBe("05:07");
  });

  it("handles midnight correctly", () => {
    vi.setSystemTime(new Date(2026, 11, 31, 0, 0, 0)); // Dec 31, 2026 00:00:00
    const result = getLocalDateTime();
    expect(result.date).toBe("2026-12-31");
    expect(result.time).toBe("00:00");
  });

  it("does not include seconds in the time string", () => {
    vi.setSystemTime(new Date(2026, 1, 7, 14, 30, 45));
    const result = getLocalDateTime();
    expect(result.time).not.toContain("45");
    expect(result.time.split(":")).toHaveLength(2);
  });
});
