import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the database
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
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
  mockLimit.mockResolvedValue([]);
  mockOrderBy.mockReturnValue({ limit: mockLimit });
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
        heartRate: 72,
        bodyPosition: "sitting_down",
        measurementLocation: "left_upper_arm",
      },
    ];

    const count = await upsertBloodPressureReadings("user-123", readings);

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: "user-123", measuredAt: new Date("2026-03-01T09:00:00.000Z"), systolic: 120, diastolic: 80, heartRate: 72 }),
      ])
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.arrayContaining([expect.anything(), expect.anything()]),
        set: expect.objectContaining({
          zoneOffset: "mocked-sql",
          systolic: "mocked-sql",
          diastolic: "mocked-sql",
          heartRate: "mocked-sql",
          bodyPosition: "mocked-sql",
          measurementLocation: "mocked-sql",
        }),
      })
    );
    expect(count).toBe(1);
  });

  it("stores a null heartRate when the reading has none", async () => {
    mockOnConflictDoUpdate.mockResolvedValueOnce(undefined);
    const { upsertBloodPressureReadings } = await import("@/lib/health-readings");

    await upsertBloodPressureReadings("user-123", [
      { measuredAt: "2026-03-01T09:00:00.000Z", zoneOffset: null, systolic: 120, diastolic: 80, heartRate: null, bodyPosition: null, measurementLocation: null },
    ]);

    expect(mockValues).toHaveBeenCalledWith([expect.objectContaining({ heartRate: null })]);
  });

  it("on conflict keeps the stored heartRate unless the incoming reading carries one (COALESCE)", async () => {
    mockOnConflictDoUpdate.mockResolvedValueOnce(undefined);
    mockSql.mockReturnValue("mocked-sql");
    const { upsertBloodPressureReadings } = await import("@/lib/health-readings");
    const { bloodPressureReadings } = await import("@/db/schema");

    await upsertBloodPressureReadings("user-123", [
      { measuredAt: "2026-03-01T09:00:00.000Z", zoneOffset: null, systolic: 120, diastolic: 80, heartRate: null, bodyPosition: null, measurementLocation: null },
    ]);

    const heartRateSql = mockSql.mock.calls.find(([strings]) =>
      (strings as TemplateStringsArray).join("").includes("heart_rate")
    );
    expect(heartRateSql).toBeDefined();
    const [strings, ...params] = heartRateSql!;
    expect([...(strings as TemplateStringsArray)]).toEqual(["coalesce(excluded.heart_rate, ", ")"]);
    expect(params).toEqual([bloodPressureReadings.heartRate]);
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
    mockLimit.mockResolvedValueOnce([
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
    mockLimit.mockResolvedValueOnce([]);
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
    mockLimit.mockResolvedValueOnce([]);

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
    mockLimit.mockResolvedValueOnce([
      {
        id: 1,
        measuredAt: new Date("2026-03-01T09:00:00.000Z"),
        zoneOffset: "-05:00",
        systolic: 120,
        diastolic: 80,
        heartRate: 72,
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
        heartRate: 72,
      }),
    ]);
  });

  it("maps a missing heart rate to null", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 2,
        measuredAt: new Date("2026-03-01T10:00:00.000Z"),
        zoneOffset: null,
        systolic: 118,
        diastolic: 78,
        heartRate: null,
        bodyPosition: null,
        measurementLocation: null,
      },
    ]);

    const { getBloodPressureReadings } = await import("@/lib/health-readings");
    const result = await getBloodPressureReadings("user-123", "2026-03-01", "2026-03-01");

    expect(result).toEqual([
      {
        id: 2,
        measuredAt: "2026-03-01T10:00:00.000Z",
        zoneOffset: null,
        systolic: 118,
        diastolic: 78,
        heartRate: null,
        bodyPosition: null,
        measurementLocation: null,
      },
    ]);
  });

  it("queries date range with inclusive end-of-day bound ordered ascending", async () => {
    mockLimit.mockResolvedValueOnce([]);
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
    mockLimit.mockResolvedValueOnce([]);

    const { getBloodPressureReadings } = await import("@/lib/health-readings");
    const result = await getBloodPressureReadings("user-123", "2026-03-01", "2026-03-07");

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Batch dedupe, hydration, and row limit
// ---------------------------------------------------------------------------
describe("readings batch dedupe (same measuredAt in one batch, last wins)", () => {
  beforeEach(() => {
    setupMocks();
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("glucose: collapses duplicate instants (different offsets spelling the same instant) keeping the last", async () => {
    const { upsertGlucoseReadings } = await import("@/lib/health-readings");

    const count = await upsertGlucoseReadings("user-123", [
      { measuredAt: "2026-03-01T08:00:00.000Z", zoneOffset: null, valueMgDl: 90, relationToMeal: null, mealType: null, specimenSource: null },
      { measuredAt: "2026-03-01T09:00:00.000Z", zoneOffset: null, valueMgDl: 110, relationToMeal: null, mealType: null, specimenSource: null },
      { measuredAt: "2026-03-01T05:00:00-03:00", zoneOffset: "-03:00", valueMgDl: 95, relationToMeal: null, mealType: null, specimenSource: null },
    ]);

    expect(count).toBe(2);
    const values = mockValues.mock.calls[0][0] as { valueMgDl: string }[];
    expect(values).toHaveLength(2);
    // the 08:00Z instant keeps the LAST submitted value (95), listed after the 09:00Z reading
    expect(values.map((v) => v.valueMgDl)).toEqual(["110", "95"]);
  });

  it("blood pressure: collapses duplicate instants keeping the last", async () => {
    const { upsertBloodPressureReadings } = await import("@/lib/health-readings");

    const count = await upsertBloodPressureReadings("user-123", [
      { measuredAt: "2026-03-01T08:00:00Z", zoneOffset: null, systolic: 120, diastolic: 80, heartRate: 70, bodyPosition: null, measurementLocation: null },
      { measuredAt: "2026-03-01T08:00:00Z", zoneOffset: null, systolic: 130, diastolic: 85, heartRate: 75, bodyPosition: null, measurementLocation: null },
    ]);

    expect(count).toBe(1);
    const values = mockValues.mock.calls[0][0] as { systolic: number; heartRate: number | null }[];
    expect(values).toHaveLength(1);
    expect(values[0].systolic).toBe(130);
    expect(values[0].heartRate).toBe(75);
  });

  it("hydration: collapses duplicate instants keeping the last", async () => {
    const { upsertHydrationReadings } = await import("@/lib/health-readings");

    const count = await upsertHydrationReadings("user-123", [
      { measuredAt: "2026-03-01T08:00:00Z", zoneOffset: null, volumeMl: 200 },
      { measuredAt: "2026-03-01T08:00:00Z", zoneOffset: null, volumeMl: 350 },
    ]);

    expect(count).toBe(1);
    const values = mockValues.mock.calls[0][0] as { volumeMl: number }[];
    expect(values).toEqual([expect.objectContaining({ volumeMl: 350 })]);
  });
});

describe("readings GET row limit", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it.each([
    ["getGlucoseReadings"],
    ["getBloodPressureReadings"],
    ["getHydrationReadings"],
  ] as const)("%s requests MAX+1 rows and throws instead of truncating silently", async (fn) => {
    const mod = await import("@/lib/health-readings");
    const { MAX_READINGS_ROWS } = await import("@/lib/reading-validation");

    mockLimit.mockResolvedValueOnce(new Array(MAX_READINGS_ROWS + 1).fill({}));
    await expect(mod[fn]("user-123", "2026-03-01", "2026-03-31")).rejects.toThrow("READINGS_LIMIT_EXCEEDED");
    expect(mockLimit).toHaveBeenCalledWith(MAX_READINGS_ROWS + 1);
  });

  it("hydration: returns mapped rows within the limit", async () => {
    const { getHydrationReadings } = await import("@/lib/health-readings");
    mockLimit.mockResolvedValueOnce([
      { id: 1, measuredAt: new Date("2026-03-01T08:00:00.000Z"), zoneOffset: null, volumeMl: 250 },
    ]);

    const result = await getHydrationReadings("user-123", "2026-03-01", "2026-03-01");

    expect(result).toEqual([{ id: 1, measuredAt: "2026-03-01T08:00:00.000Z", zoneOffset: null, volumeMl: 250 }]);
  });
});

// ---------------------------------------------------------------------------
// Waist circumference
// ---------------------------------------------------------------------------
describe("upsertWaistReadings", () => {
  beforeEach(() => {
    setupMocks();
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("inserts readings and upserts on (userId, measuredAt) overwriting zoneOffset and valueCm", async () => {
    mockSql.mockReturnValue("mocked-sql");
    const { upsertWaistReadings } = await import("@/lib/health-readings");
    const { waistReadings } = await import("@/db/schema");

    const count = await upsertWaistReadings("user-123", [
      { measuredAt: "2026-10-28T11:05:00.000Z", zoneOffset: "-03:00", valueCm: 104.5 },
      { measuredAt: "2026-10-29T11:05:00.000Z", zoneOffset: null, valueCm: 104 },
    ]);

    expect(count).toBe(2);
    expect(mockInsert).toHaveBeenCalledWith(waistReadings);
    expect(mockValues).toHaveBeenCalledWith([
      { userId: "user-123", measuredAt: new Date("2026-10-28T11:05:00.000Z"), zoneOffset: "-03:00", valueCm: "104.5" },
      { userId: "user-123", measuredAt: new Date("2026-10-29T11:05:00.000Z"), zoneOffset: null, valueCm: "104" },
    ]);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith({
      target: [waistReadings.userId, waistReadings.measuredAt],
      set: { zoneOffset: "mocked-sql", valueCm: "mocked-sql" },
    });

    const setSql = mockSql.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join(""));
    expect(setSql).toEqual(expect.arrayContaining(["excluded.zone_offset", "excluded.value_cm"]));
  });

  it.each([
    [104.55, "104.6"],
    [104.44, "104.4"],
    [104.46, "104.5"],
    [99.95, "100"],
    [300, "300"],
  ])("stores valueCm %s rounded to one decimal as %s", async (valueCm, stored) => {
    const { upsertWaistReadings } = await import("@/lib/health-readings");

    await upsertWaistReadings("user-123", [{ measuredAt: "2026-10-28T11:05:00.000Z", zoneOffset: null, valueCm }]);

    expect(mockValues).toHaveBeenCalledWith([expect.objectContaining({ valueCm: stored })]);
  });

  it("collapses duplicate instants within one batch keeping the last", async () => {
    const { upsertWaistReadings } = await import("@/lib/health-readings");

    const count = await upsertWaistReadings("user-123", [
      { measuredAt: "2026-10-28T11:05:00.000Z", zoneOffset: null, valueCm: 104.5 },
      { measuredAt: "2026-10-28T08:05:00-03:00", zoneOffset: "-03:00", valueCm: 103.9 },
    ]);

    expect(count).toBe(1);
    expect(mockValues).toHaveBeenCalledWith([expect.objectContaining({ valueCm: "103.9", zoneOffset: "-03:00" })]);
  });

  it("returns 0 and skips DB call for empty array", async () => {
    const { upsertWaistReadings } = await import("@/lib/health-readings");

    const count = await upsertWaistReadings("user-123", []);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});

describe("getWaistReadings", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("queries the UTC day range ordered ascending and maps numeric strings to numbers", async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 1, userId: "user-123", measuredAt: new Date("2026-10-01T11:05:00.000Z"), zoneOffset: "-03:00", valueCm: "104.5" },
      { id: 2, userId: "user-123", measuredAt: new Date("2026-10-28T11:05:00.000Z"), zoneOffset: null, valueCm: "104" },
    ]);
    mockBetween.mockReturnValue("mocked-between-condition");
    mockEq.mockReturnValue("mocked-eq-condition");
    mockAnd.mockReturnValue("mocked-and-condition");

    const { getWaistReadings } = await import("@/lib/health-readings");
    const { waistReadings } = await import("@/db/schema");
    const result = await getWaistReadings("user-123", "2026-10-01", "2026-10-28");

    expect(mockFrom).toHaveBeenCalledWith(waistReadings);
    expect(mockEq).toHaveBeenCalledWith(waistReadings.userId, "user-123");
    expect(mockBetween).toHaveBeenCalledWith(
      waistReadings.measuredAt,
      new Date("2026-10-01T00:00:00.000Z"),
      new Date("2026-10-28T23:59:59.999Z")
    );
    expect(mockAsc).toHaveBeenCalledWith(waistReadings.measuredAt);
    expect(result).toEqual([
      { id: 1, measuredAt: "2026-10-01T11:05:00.000Z", zoneOffset: "-03:00", valueCm: 104.5 },
      { id: 2, measuredAt: "2026-10-28T11:05:00.000Z", zoneOffset: null, valueCm: 104 },
    ]);
  });

  it("returns empty array when no readings in range", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const { getWaistReadings } = await import("@/lib/health-readings");
    const result = await getWaistReadings("user-123", "2026-10-01", "2026-10-28");

    expect(result).toEqual([]);
  });

  it("requests MAX+1 rows and throws instead of truncating silently", async () => {
    const { getWaistReadings } = await import("@/lib/health-readings");
    const { MAX_READINGS_ROWS } = await import("@/lib/reading-validation");

    mockLimit.mockResolvedValueOnce(new Array(MAX_READINGS_ROWS + 1).fill({}));
    await expect(getWaistReadings("user-123", "2026-10-01", "2026-10-28")).rejects.toThrow("READINGS_LIMIT_EXCEEDED");
    expect(mockLimit).toHaveBeenCalledWith(MAX_READINGS_ROWS + 1);
  });
});
