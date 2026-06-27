import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "@/lib/logger";
import type { FoodAnalysis, ServingUnit } from "@/types";
import schemaFixture from "./fixtures/google-health-v4-schemas.json";

/**
 * Contract test (P1-14): guards the request bodies that production code in
 * src/lib/google-health.ts builds against the pinned Google Health API v4
 * discovery-doc schemas in fixtures/google-health-v4-schemas.json.
 *
 * WHY: the hand-authored mocks/fixtures in google-health.test.ts can silently drift
 * from the real wire contract — that is exactly how the invalid `utcOffset` on
 * CivilDateTime (P0-4) survived until it 400'd in production. This harness drives the
 * REAL code paths (createNutritionLog, getHealthActivitySummary) through a mocked
 * fetch, captures the outbound JSON body, and validates it against the schema fixture.
 * It must FAIL if anyone re-adds `utcOffset` to the dailyRollUp range, sends an unknown
 * NutritionLog field, or emits an invalid mealType / nutrient enum value.
 *
 * No network and no new deps (no ajv): a tiny structural validator below interprets the
 * fixture. The fixture is the source of truth — update it deliberately when the real
 * discovery doc changes.
 */

// ─── env + dependency mocks (mirror google-health.test.ts) ────────────────────

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("HEALTH_DRY_RUN", "false");

const warnMock = vi.fn();
const debugMock = vi.fn();
const infoMock = vi.fn();
const errorMock = vi.fn();

vi.mock("@/lib/logger", () => ({
  logger: {
    info: infoMock,
    warn: warnMock,
    error: errorMock,
    debug: debugMock,
    child: vi.fn(),
  },
  startTimer: () => () => 42,
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/health-tokens", () => ({
  getHealthTokens: vi.fn(),
  upsertHealthTokens: vi.fn(),
}));

// No active cooldown: the breaker is a no-op so the real body is built + captured.
vi.mock("@/lib/google-health-rate-limit", () => ({
  assertRateLimitAllowed: vi.fn(),
  recordRateLimitHeaders: vi.fn(),
  recordResourceExhaustedCooldown: vi.fn(),
  getRateLimitSnapshot: vi.fn().mockReturnValue(null),
}));

const fakeLog: Logger = {
  warn: warnMock,
  debug: debugMock,
  info: infoMock,
  error: errorMock,
} as unknown as Logger;

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── structural validator over the discovery-schema fixture ───────────────────

type FieldDef =
  | { type: "string" | "number" | "boolean" }
  | { type: "array"; items: FieldDef }
  | { ref: string }
  | { enum: string };

interface ObjectSchema {
  type: "object";
  fields: Record<string, FieldDef>;
}

const schemas = schemaFixture.schemas as unknown as Record<string, ObjectSchema>;
const enums = schemaFixture.enums as unknown as Record<string, string[]>;

function validateValue(value: unknown, def: FieldDef, path: string, errors: string[]): void {
  if ("ref" in def) {
    const refSchema = schemas[def.ref];
    if (!refSchema) {
      errors.push(`${path}: schema ref "${def.ref}" missing from fixture`);
      return;
    }
    validateObject(value, refSchema, path, errors);
    return;
  }
  if ("enum" in def) {
    const members = enums[def.enum];
    if (!Array.isArray(members)) {
      errors.push(`${path}: enum "${def.enum}" missing from fixture`);
      return;
    }
    if (typeof value !== "string" || !members.includes(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} is not a member of enum ${def.enum}`);
    }
    return;
  }
  if (def.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array, got ${typeof value}`);
      return;
    }
    value.forEach((item, i) => validateValue(item, def.items, `${path}[${i}]`, errors));
    return;
  }
  if (typeof value !== def.type) {
    errors.push(`${path}: expected ${def.type}, got ${typeof value}`);
  }
}

function validateObject(value: unknown, schema: ObjectSchema, path: string, errors: string[]): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const got = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    errors.push(`${path}: expected object, got ${got}`);
    return;
  }
  for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    const def = schema.fields[key];
    if (!def) {
      errors.push(`${path}.${key}: unknown field — not present in schema (wire-contract drift)`);
      continue;
    }
    validateValue(fieldValue, def, `${path}.${key}`, errors);
  }
}

/** Validate `value` against a named root schema; returns [] when it conforms. */
function validateAgainstSchema(value: unknown, rootSchemaName: string): string[] {
  const root = schemas[rootSchemaName];
  if (!root) return [`root schema "${rootSchemaName}" missing from fixture`];
  const errors: string[] = [];
  validateObject(value, root, rootSchemaName, errors);
  return errors;
}

/** Recursively reports whether any object in `value` owns the exact key `key`. */
function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, key));
  if (value !== null && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
    return Object.values(value).some((v) => hasKeyDeep(v, key));
  }
  return false;
}

// ─── fixtures for driving the real code ───────────────────────────────────────

// All optional fields populated so the captured body exercises energyFromFat, the
// SATURATED_FAT / TRANS_FAT / SUGAR nutrients, the interval, and the mealType branches.
const fullFood: FoodAnalysis = {
  food_name: "Test Chicken",
  amount: 200,
  unit_id: "g" as ServingUnit,
  calories: 320.7,
  protein_g: 30,
  carbs_g: 12,
  fat_g: 10,
  fiber_g: 4,
  sodium_mg: 150,
  saturated_fat_g: 3,
  trans_fat_g: 0.2,
  sugars_g: 5,
  calories_from_fat: 90,
  confidence: "high",
  notes: "",
  description: "",
  keywords: [],
};

const fullTiming = {
  date: "2026-02-08",
  time: "20:00:00",
  zoneOffset: "-03:00",
  mealTypeId: 5, // → DINNER
};

function capturedBody(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): unknown {
  const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("google-health v4 request-body contract", () => {
  let createNutritionLog: typeof import("@/lib/google-health").createNutritionLog;
  let getHealthActivitySummary: typeof import("@/lib/google-health").getHealthActivitySummary;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const mod = await import("@/lib/google-health");
    createNutritionLog = mod.createNutritionLog;
    getHealthActivitySummary = mod.getHealthActivitySummary;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("validator self-check (the harness itself is sound)", () => {
    it("passes a known-good minimal NutritionLog request", () => {
      const good = {
        nutritionLog: {
          foodDisplayName: "x",
          energy: { kcal: 100 },
          totalFat: { grams: 1 },
          totalCarbohydrate: { grams: 1 },
          serving: { amount: 1, foodMeasurementUnit: "g" },
          nutrients: [{ nutrient: "PROTEIN", quantity: { grams: 2 } }],
        },
      };
      expect(validateAgainstSchema(good, "DataPointCreateRequest")).toEqual([]);
    });

    it("flags an unknown NutritionLog field", () => {
      const bad = {
        nutritionLog: {
          foodDisplayName: "x",
          energy: { kcal: 100 },
          totalFat: { grams: 1 },
          totalCarbohydrate: { grams: 1 },
          serving: { amount: 1, foodMeasurementUnit: "g" },
          nutrients: [],
          bogusField: true,
        },
      };
      const errors = validateAgainstSchema(bad, "DataPointCreateRequest");
      expect(errors.some((e) => e.includes("bogusField"))).toBe(true);
    });

    it("flags an invalid mealType enum value", () => {
      const bad = {
        nutritionLog: {
          foodDisplayName: "x",
          energy: { kcal: 100 },
          totalFat: { grams: 1 },
          totalCarbohydrate: { grams: 1 },
          serving: { amount: 1, foodMeasurementUnit: "g" },
          nutrients: [],
          mealType: "BRUNCH",
        },
      };
      const errors = validateAgainstSchema(bad, "DataPointCreateRequest");
      expect(errors.some((e) => e.includes("MealType"))).toBe(true);
    });

    it("flags an invalid nutrient enum value", () => {
      const bad = {
        nutritionLog: {
          foodDisplayName: "x",
          energy: { kcal: 100 },
          totalFat: { grams: 1 },
          totalCarbohydrate: { grams: 1 },
          serving: { amount: 1, foodMeasurementUnit: "g" },
          nutrients: [{ nutrient: "VITAMIN_C", quantity: { grams: 1 } }],
        },
      };
      const errors = validateAgainstSchema(bad, "DataPointCreateRequest");
      expect(errors.some((e) => e.includes("Nutrient"))).toBe(true);
    });

    it("flags a wrong primitive type (kcal as string)", () => {
      const bad = {
        nutritionLog: {
          foodDisplayName: "x",
          energy: { kcal: "100" },
          totalFat: { grams: 1 },
          totalCarbohydrate: { grams: 1 },
          serving: { amount: 1, foodMeasurementUnit: "g" },
          nutrients: [],
        },
      };
      const errors = validateAgainstSchema(bad, "DataPointCreateRequest");
      expect(errors.some((e) => e.includes("expected number"))).toBe(true);
    });

    it("flags a utcOffset re-added to a CivilDateTime in the dailyRollUp range (P0-4 regression)", () => {
      const bad = {
        range: {
          start: { date: { year: 2026, month: 2, day: 8 }, utcOffset: "0s" },
          end: { date: { year: 2026, month: 2, day: 9 } },
        },
        windowSizeDays: 1,
      };
      const errors = validateAgainstSchema(bad, "DailyRollUpRequest");
      expect(errors.some((e) => e.includes("utcOffset"))).toBe(true);
      expect(hasKeyDeep(bad.range, "utcOffset")).toBe(true);
    });
  });

  describe("createNutritionLog → NutritionLog DataPoint create body", () => {
    it("conforms to the v4 DataPointCreateRequest / NutritionLog schema", async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          name: "operations/x",
          done: true,
          response: { name: "users/me/dataTypes/nutrition-log/dataPoints/abc" },
        }),
      );

      await createNutritionLog("token", fullFood, fullTiming, fakeLog, "user-1");

      const body = capturedBody(fetchMock);
      const errors = validateAgainstSchema(body, "DataPointCreateRequest");
      expect(errors).toEqual([]);
    });

    it("emits a valid mealType enum member and only known nutrient enum members", async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          name: "operations/x",
          done: true,
          response: { name: "users/me/dataTypes/nutrition-log/dataPoints/abc" },
        }),
      );

      await createNutritionLog("token", fullFood, fullTiming, fakeLog, "user-1");

      const body = capturedBody(fetchMock) as { nutritionLog: Record<string, unknown> };
      const nl = body.nutritionLog;
      expect(enums.MealType).toContain(nl.mealType as string);
      const nutrients = nl.nutrients as Array<{ nutrient: string }>;
      for (const n of nutrients) {
        expect(enums.Nutrient).toContain(n.nutrient);
      }
    });
  });

  describe("getHealthActivitySummary → dailyRollUp body", () => {
    it("conforms to the v4 DailyRollUpRequest / CivilTimeInterval schema", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ rollupDataPoints: [] }));

      await getHealthActivitySummary("token", "2026-02-08", fakeLog, "user-1");

      const body = capturedBody(fetchMock);
      const errors = validateAgainstSchema(body, "DailyRollUpRequest");
      expect(errors).toEqual([]);
    });

    it("the range carries NO utcOffset key anywhere — CivilDateTime is civil-only (P0-4 guard)", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ rollupDataPoints: [] }));

      await getHealthActivitySummary("token", "2026-02-08", fakeLog, "user-1");

      const body = capturedBody(fetchMock) as { range: unknown };
      expect(hasKeyDeep(body.range, "utcOffset")).toBe(false);
    });
  });
});
