import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { logger } = await import("@/lib/logger");

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: () => ({
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return { from: mockFrom };
    },
  }),
}));

vi.mock("@/db/schema", async (importOriginal) => {
  return importOriginal();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ where: mockWhere });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const { getFastingWindow, getFastingWindows } = await import("@/lib/fasting");

describe("getFastingWindow", () => {
  const userId = "user-123";

  it("returns completed fasting window when both meals exist", async () => {
    mockWhere.mockResolvedValueOnce([
      { date: "2026-02-11", time: "22:00:00" }, // Last meal previous day
      { date: "2026-02-12", time: "10:00:00" }, // First meal current day
    ]);

    const result = await getFastingWindow(userId, "2026-02-12");

    expect(result).toEqual({
      date: "2026-02-12",
      lastMealTime: "22:00:00",
      firstMealTime: "10:00:00",
      durationMinutes: 720, // 12 hours: 10:00 + 1440 - 22:00 = 600 + 1440 - 1320 = 720
    });
  });

  it("returns ongoing fasting window when no meal on current day", async () => {
    mockWhere.mockResolvedValueOnce([
      { date: "2026-02-11", time: "20:30:00" }, // Last meal previous day
    ]);

    const result = await getFastingWindow(userId, "2026-02-12");

    expect(result).toEqual({
      date: "2026-02-12",
      lastMealTime: "20:30:00",
      firstMealTime: null,
      durationMinutes: null,
    });
  });

  it("returns null when no meals on previous day", async () => {
    mockWhere.mockResolvedValueOnce([
      { date: "2026-02-12", time: "10:00:00" }, // Only current day meal
    ]);

    const result = await getFastingWindow(userId, "2026-02-12");

    expect(result).toBeNull();
  });

  it("returns null when no data at all", async () => {
    mockWhere.mockResolvedValueOnce([]);

    const result = await getFastingWindow(userId, "2026-02-12");

    expect(result).toBeNull();
  });

  it("handles multiple meals correctly by finding max/min", async () => {
    mockWhere.mockResolvedValueOnce([
      { date: "2026-02-11", time: "08:00:00" },
      { date: "2026-02-11", time: "12:00:00" },
      { date: "2026-02-11", time: "21:00:00" }, // MAX from prev day
      { date: "2026-02-12", time: "09:00:00" }, // MIN from current day
      { date: "2026-02-12", time: "13:00:00" },
      { date: "2026-02-12", time: "19:00:00" },
    ]);

    const result = await getFastingWindow(userId, "2026-02-12");

    expect(result).toEqual({
      date: "2026-02-12",
      lastMealTime: "21:00:00",
      firstMealTime: "09:00:00",
      durationMinutes: 720, // 9:00 + 1440 - 21:00 = 540 + 1440 - 1260 = 720
    });
  });

  it("handles cross-midnight duration calculation", async () => {
    mockWhere.mockResolvedValueOnce([
      { date: "2026-02-11", time: "23:30:00" }, // 23:30 = 1410 minutes
      { date: "2026-02-12", time: "06:00:00" }, // 06:00 = 360 minutes
    ]);

    const result = await getFastingWindow(userId, "2026-02-12");

    expect(result).toEqual({
      date: "2026-02-12",
      lastMealTime: "23:30:00",
      firstMealTime: "06:00:00",
      durationMinutes: 390, // 360 + 1440 - 1410 = 390 (6.5 hours)
    });
  });
});

describe("getFastingWindows", () => {
  const userId = "user-123";

  it("returns multiple fasting windows for date range", async () => {
    mockWhere.mockResolvedValueOnce([
      { date: "2026-02-10", time: "20:00:00" },
      { date: "2026-02-11", time: "10:00:00" },
      { date: "2026-02-11", time: "21:00:00" },
      { date: "2026-02-12", time: "09:00:00" },
      { date: "2026-02-12", time: "22:00:00" },
      { date: "2026-02-13", time: "08:00:00" },
    ]);

    const result = await getFastingWindows(userId, "2026-02-11", "2026-02-13");

    expect(result).toEqual([
      {
        date: "2026-02-11",
        lastMealTime: "20:00:00",
        firstMealTime: "10:00:00",
        durationMinutes: 840, // 10:00 + 1440 - 20:00 = 600 + 1440 - 1200 = 840
      },
      {
        date: "2026-02-12",
        lastMealTime: "21:00:00",
        firstMealTime: "09:00:00",
        durationMinutes: 720, // 9:00 + 1440 - 21:00 = 540 + 1440 - 1260 = 720
      },
      {
        date: "2026-02-13",
        lastMealTime: "22:00:00",
        firstMealTime: "08:00:00",
        durationMinutes: 600, // 8:00 + 1440 - 22:00 = 480 + 1440 - 1320 = 600
      },
    ]);
  });

  it("handles ongoing fast in date range", async () => {
    mockWhere.mockResolvedValueOnce([
      { date: "2026-02-10", time: "20:00:00" },
      { date: "2026-02-11", time: "10:00:00" },
      { date: "2026-02-11", time: "21:00:00" },
      { date: "2026-02-12", time: "09:00:00" },
      // No meal on 2026-02-12, so 2026-02-13 has ongoing fast
    ]);

    const result = await getFastingWindows(userId, "2026-02-11", "2026-02-13");

    expect(result).toEqual([
      {
        date: "2026-02-11",
        lastMealTime: "20:00:00",
        firstMealTime: "10:00:00",
        durationMinutes: 840,
      },
      {
        date: "2026-02-12",
        lastMealTime: "21:00:00",
        firstMealTime: "09:00:00",
        durationMinutes: 720,
      },
      {
        date: "2026-02-13",
        lastMealTime: "09:00:00",
        firstMealTime: null,
        durationMinutes: null,
      },
    ]);
  });

  it("returns empty array when no data", async () => {
    mockWhere.mockResolvedValueOnce([]);

    const result = await getFastingWindows(userId, "2026-02-11", "2026-02-13");

    expect(result).toEqual([]);
  });

  it("skips dates with no previous day meal", async () => {
    mockWhere.mockResolvedValueOnce([
      // No meal on 2026-02-10, so 2026-02-11 is skipped
      { date: "2026-02-11", time: "21:00:00" },
      { date: "2026-02-12", time: "09:00:00" },
    ]);

    const result = await getFastingWindows(userId, "2026-02-11", "2026-02-12");

    expect(result).toEqual([
      {
        date: "2026-02-12",
        lastMealTime: "21:00:00",
        firstMealTime: "09:00:00",
        durationMinutes: 720,
      },
    ]);
  });
});

describe("debug logging", () => {
  beforeEach(() => {
    vi.mocked(logger.debug).mockClear();
  });

  it("getFastingWindow logs debug with date and result", async () => {
    mockWhere.mockResolvedValue([
      { date: "2026-02-10", time: "20:00:00" },
      { date: "2026-02-11", time: "08:00:00" },
    ]);

    await getFastingWindow("user-123", "2026-02-11");

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: "get_fasting_window", date: "2026-02-11" }),
      expect.any(String),
    );
  });
});
