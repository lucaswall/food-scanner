import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the database
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockAnd = vi.fn();
const mockBetween = vi.fn();
const mockEq = vi.fn();
const mockAsc = vi.fn();
const mockSql = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: () => ({
    insert: mockInsert,
    select: mockSelect,
  }),
}));

vi.mock("drizzle-orm", () => ({
  and: mockAnd,
  between: mockBetween,
  eq: mockEq,
  asc: mockAsc,
  sql: mockSql,
}));

function setupMocks() {
  vi.clearAllMocks();

  // Setup default mock chain for insert
  mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  mockInsert.mockReturnValue({ values: mockValues });

  // Setup default mock chain for select
  mockOrderBy.mockResolvedValue([]);
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

// ---------------------------------------------------------------------------
// Glucose upsert tests
// ---------------------------------------------------------------------------
describe("upsertGlucoseReadings", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("calls insert with onConflictDoUpdate with correct target", async () => {
    mockOnConflictDoUpdate.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    mockSql.mockReturnValue("mocked-sql");

    const { upsertGlucoseReadings } = await import("@/lib/health-readings");

    const readings = [
      {
        measuredAt: "2026-03-01T08:00:00.000Z",
        zoneOffset: "-05:00",
        valueMgDl: 95,
        relationToMeal: "fasting",
        mealType: null,
        specimenSource: "capillary_blood",
      },
      {
        measuredAt: "2026-03-01T12:00:00.000Z",
        zoneOffset: "-05:00",
        valueMgDl: 140,
        relationToMeal: "after_meal",
        mealType: "lunch",
        specimenSource: null,
      },
    ];

    const count = await upsertGlucoseReadings("user-123", readings);

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: "user-123", measuredAt: new Date("2026-03-01T08:00:00.000Z") }),
        expect.objectContaining({ userId: "user-123", measuredAt: new Date("2026-03-01T12:00:00.000Z") }),
      ])
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.arrayContaining([expect.anything(), expect.anything()]),
        set: expect.objectContaining({
          zoneOffset: "mocked-sql",
          valueMgDl: "mocked-sql",
          relationToMeal: "mocked-sql",
          mealType: "mocked-sql",
          specimenSource: "mocked-sql",
        }),
      })
    );
    expect(count).toBe(2);
  });

  it("returns 0 and skips DB call for empty array", async () => {
    const { upsertGlucoseReadings } = await import("@/lib/health-readings");

    const count = await upsertGlucoseReadings("user-123", []);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Blood pressure upsert tests
// ---------------------------------------------------------------------------
describe("upsertBloodPressureReadings", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("calls insert with onConflictDoUpdate with correct target", async () => {
    mockOnConflictDoUpdate.mockResolvedValueOnce([{ id: 1 }]);
    mockSql.mockReturnValue("mocked-sql");

    const { upsertBloodPressureReadings } = await import("@/lib/health-readings");

    const readings = [
      {
        measuredAt: "2026-03-01T09:00:00.000Z",
        zoneOffset: "-05:00",
        systolic: 120,
        diastolic: 80,
        bodyPosition: "sitting_down",
        measurementLocation: "left_upper_arm",
      },
    ];

    const count = await upsertBloodPressureReadings("user-123", readings);

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: "user-123", measuredAt: new Date("2026-03-01T09:00:00.000Z"), systolic: 120, diastolic: 80 }),
      ])
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.arrayContaining([expect.anything(), expect.anything()]),
        set: expect.objectContaining({
          zoneOffset: "mocked-sql",
          systolic: "mocked-sql",
          diastolic: "mocked-sql",
          bodyPosition: "mocked-sql",
          measurementLocation: "mocked-sql",
        }),
      })
    );
    expect(count).toBe(1);
  });

  it("returns 0 and skips DB call for empty array", async () => {
    const { upsertBloodPressureReadings } = await import("@/lib/health-readings");

    const count = await upsertBloodPressureReadings("user-123", []);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Glucose query tests
// ---------------------------------------------------------------------------
describe("getGlucoseReadings", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("queries single date with start-of-day and end-of-day bounds ordered ascending", async () => {
    mockOrderBy.mockResolvedValueOnce([
      {
        id: 1,
        measuredAt: new Date("2026-03-01T08:00:00.000Z"),
        zoneOffset: "-05:00",
        valueMgDl: "95",
        relationToMeal: "fasting",
        mealType: null,
        specimenSource: "capillary_blood",
      },
    ]);
    mockAnd.mockReturnValue("mocked-and-condition");
    mockEq.mockReturnValue("mocked-eq-condition");
    mockBetween.mockReturnValue("mocked-between-condition");

    const { getGlucoseReadings } = await import("@/lib/health-readings");
    const result = await getGlucoseReadings("user-123", "2026-03-01", "2026-03-01");

    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalled();
    expect(mockBetween).toHaveBeenCalledWith(
      expect.anything(),
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-01T23:59:59.999Z")
    );
    expect(mockAnd).toHaveBeenCalled();
    expect(mockOrderBy).toHaveBeenCalled();
    expect(mockAsc).toHaveBeenCalled();

    expect(result).toEqual([
      expect.objectContaining({
        id: 1,
        valueMgDl: 95,
        relationToMeal: "fasting",
        specimenSource: "capillary_blood",
      }),
    ]);
  });

  it("queries date range with inclusive end-of-day bound ordered ascending", async () => {
    mockOrderBy.mockResolvedValueOnce([]);
    mockBetween.mockReturnValue("mocked-between-condition");
    mockEq.mockReturnValue("mocked-eq-condition");
    mockAnd.mockReturnValue("mocked-and-condition");

    const { getGlucoseReadings } = await import("@/lib/health-readings");
    await getGlucoseReadings("user-123", "2026-03-01", "2026-03-07");

    expect(mockBetween).toHaveBeenCalledWith(
      expect.anything(),
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-07T23:59:59.999Z")
    );
  });

  it("returns empty array when no readings in range", async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    const { getGlucoseReadings } = await import("@/lib/health-readings");
    const result = await getGlucoseReadings("user-123", "2026-03-01", "2026-03-07");

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Blood pressure query tests
// ---------------------------------------------------------------------------
describe("getBloodPressureReadings", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("queries single date with start-of-day and end-of-day bounds ordered ascending", async () => {
    mockOrderBy.mockResolvedValueOnce([
      {
        id: 1,
        measuredAt: new Date("2026-03-01T09:00:00.000Z"),
        zoneOffset: "-05:00",
        systolic: 120,
        diastolic: 80,
        bodyPosition: "sitting_down",
        measurementLocation: "left_upper_arm",
      },
    ]);
    mockAnd.mockReturnValue("mocked-and-condition");
    mockEq.mockReturnValue("mocked-eq-condition");
    mockBetween.mockReturnValue("mocked-between-condition");

    const { getBloodPressureReadings } = await import("@/lib/health-readings");
    const result = await getBloodPressureReadings("user-123", "2026-03-01", "2026-03-01");

    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalled();
    expect(mockBetween).toHaveBeenCalledWith(
      expect.anything(),
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-01T23:59:59.999Z")
    );
    expect(mockOrderBy).toHaveBeenCalled();
    expect(mockAsc).toHaveBeenCalled();

    expect(result).toEqual([
      expect.objectContaining({
        id: 1,
        systolic: 120,
        diastolic: 80,
      }),
    ]);
  });

  it("queries date range with inclusive end-of-day bound ordered ascending", async () => {
    mockOrderBy.mockResolvedValueOnce([]);
    mockBetween.mockReturnValue("mocked-between-condition");
    mockEq.mockReturnValue("mocked-eq-condition");
    mockAnd.mockReturnValue("mocked-and-condition");

    const { getBloodPressureReadings } = await import("@/lib/health-readings");
    await getBloodPressureReadings("user-123", "2026-03-01", "2026-03-07");

    expect(mockBetween).toHaveBeenCalledWith(
      expect.anything(),
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-07T23:59:59.999Z")
    );
  });

  it("returns empty array when no readings in range", async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    const { getBloodPressureReadings } = await import("@/lib/health-readings");
    const result = await getBloodPressureReadings("user-123", "2026-03-01", "2026-03-07");

    expect(result).toEqual([]);
  });
});
