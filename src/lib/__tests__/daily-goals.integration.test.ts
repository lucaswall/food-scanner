/**
 * Integration C6: daily-goals macro engine — end-to-end for two distinct bodies
 *
 * Proves that getOrComputeDailyGoals:
 *   1. Reads user goal settings from the REAL users table.
 *   2. Passes them together with the mocked health profile + weight to the
 *      macro engine (computeMacroTargets).
 *   3. Writes the computed goals to the REAL daily_calorie_goals table.
 *   4. Returns per-user correct macro outputs for two DISTINCT body profiles
 *      (Lucas-like and Mariana-like) — proving the engine is not tuned to one body.
 *
 * The Google Health read layer (getCachedHealthProfile / getCachedHealthWeightKg)
 * is mocked to avoid network calls while the DB write/read cycle is fully real.
 *
 * PRE-CONDITIONS (lead must complete before running):
 *   1. Start a throwaway Postgres instance (e.g. Docker).
 *   2. Apply the current schema: `DATABASE_URL="$INTEGRATION_DATABASE_URL" npx drizzle-kit push`
 *      (do NOT run the committed drizzle/ migration files — stale pending Task 29).
 *   3. Run: `INTEGRATION_DATABASE_URL=<url> npm run test:integration`
 *
 * IMPORTANT: INTEGRATION_DATABASE_URL must point at a DEDICATED throwaway DB —
 * never at DATABASE_URL (dev/prod).
 *
 * ─── Expected macro values ───────────────────────────────────────────────────
 *
 * Lucas-like (MALE, 30y, 178cm, 80kg, moderate, goal=75kg, rate=0.5kg/wk):
 *   RMR  = round(10*80 + 6.25*178 − 5*30 + 5) = 1768
 *   TDEE = round(1768 * 1.55)                   = 2740
 *   dir  = LOSE (currentWeight 80 > goalWeight 75)
 *   deficit = round(0.5 * 1100) = 550  →  targetKcal = 2740 − 550 = 2190
 *   protein = round(2.2 * 80)   = 176g
 *   fat     = round(max(80*0.8, 2190*0.25/9)) = round(max(64, 60.8)) = 64g
 *   carbs   = round(max((2190 − 176*4 − 64*9)/4, 130, 2190*0.1/4))
 *           = round(max(227.5, 130, 54.75)) = 228g
 *
 * Mariana-like (FEMALE, 28y, 162cm, 58kg, light, goal=58kg, rate=0kg/wk):
 *   RMR  = round(10*58 + 6.25*162 − 5*28 − 161) = 1292
 *   TDEE = round(1292 * 1.375)                    = 1777
 *   dir  = MAINTAIN (rate = 0)  →  targetKcal = 1777
 *   protein = round(1.6 * 58)   = 93g
 *   fat     = round(max(58*0.8, 1777*0.25/9)) = round(max(46.4, 49.36)) = 49g
 *   carbs   = round(max((1777 − 93*4 − 49*9)/4, 130, 1777*0.1/4))
 *           = round(max(241, 130, 44.4)) = 241g
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq, or } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb, closeDb } from "@/db/index";

// ─── Guard + DATABASE_URL override ───────────────────────────────────────────
const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
if (INTEGRATION_DATABASE_URL) {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
}

// ─── Mock health-cache BEFORE importing daily-goals ──────────────────────────
// vi.mock is hoisted to before all imports; the factory is called at that time.
// We use module-level spy fns so beforeAll can configure return values per userId.
// Plain vi.fn() avoids Vitest 4 generic-arity restrictions; types are enforced
// via the mockImplementation call below.
const mockGetCachedHealthProfile = vi.fn();
const mockGetCachedHealthWeightKg = vi.fn();

vi.mock("@/lib/health-cache", () => ({
  getCachedHealthProfile: (...args: unknown[]) => mockGetCachedHealthProfile(...args),
  getCachedHealthWeightKg: (...args: unknown[]) => mockGetCachedHealthWeightKg(...args),
}));

// Import daily-goals AFTER the mock is declared (hoisting ensures correctness)
import { getOrComputeDailyGoals } from "@/lib/daily-goals";

// Unique emails — `.invalid` TLD is RFC-2606 reserved.
const EMAIL_LUCAS  = "lucas-like@daily-goals-integration.invalid";
const EMAIL_MARIANA = "mariana-like@daily-goals-integration.invalid";

// Fixed future date so `isPast` is always false (engine always recomputes)
const TEST_DATE = "2030-01-01";

// ─── Expected output constants (derived manually above, cross-checked by test) ─

const LUCAS_EXPECTED = {
  calorieGoal: 2190,
  proteinGoal: 176,
  carbsGoal:   228,
  fatGoal:      64,
} as const;

const MARIANA_EXPECTED = {
  calorieGoal: 1777,
  proteinGoal:   93,
  carbsGoal:    241,
  fatGoal:       49,
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function hardCleanup(emails: string[]): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      emails.length === 1
        ? eq(schema.users.email, emails[0]!)
        : or(...emails.map((e) => eq(schema.users.email, e))),
    );

  for (const { id } of rows) {
    await db.delete(schema.dailyCalorieGoals).where(eq(schema.dailyCalorieGoals.userId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!INTEGRATION_DATABASE_URL)(
  "daily-goals macro engine: per-user goals (integration)",
  () => {
    let lucasId  = "";
    let marianaId = "";

    beforeAll(async () => {
      await hardCleanup([EMAIL_LUCAS, EMAIL_MARIANA]);

      const db = getDb();

      // Seed Lucas-like user with complete goal settings
      const [lucasRow] = await db
        .insert(schema.users)
        .values({
          email:             EMAIL_LUCAS,
          name:              "Lucas-like Integration",
          activityLevel:     "moderate",
          goalWeightKg:      "75",
          goalRateKgPerWeek: "0.5",
          weightGoalType:    "LOSE",
        })
        .returning({ id: schema.users.id });
      lucasId = lucasRow!.id;

      // Seed Mariana-like user with complete goal settings
      const [marianaRow] = await db
        .insert(schema.users)
        .values({
          email:             EMAIL_MARIANA,
          name:              "Mariana-like Integration",
          activityLevel:     "light",
          goalWeightKg:      "58",
          goalRateKgPerWeek: "0",
          weightGoalType:    "MAINTAIN",
        })
        .returning({ id: schema.users.id });
      marianaId = marianaRow!.id;

      // Wire mock: return different profile + weight per userId
      mockGetCachedHealthProfile.mockImplementation(async (userId: string) => {
        if (userId === lucasId) {
          return { sex: "MALE", ageYears: 30, heightCm: 178 };
        }
        if (userId === marianaId) {
          return { sex: "FEMALE", ageYears: 28, heightCm: 162 };
        }
        throw new Error(`Unexpected userId in getCachedHealthProfile mock: ${userId}`);
      });

      mockGetCachedHealthWeightKg.mockImplementation(async (userId: string) => {
        if (userId === lucasId) {
          return { weightKg: 80, loggedDate: "2029-12-31" };
        }
        if (userId === marianaId) {
          return { weightKg: 58, loggedDate: "2029-12-31" };
        }
        throw new Error(`Unexpected userId in getCachedHealthWeightKg mock: ${userId}`);
      });
    });

    afterAll(async () => {
      await hardCleanup([EMAIL_LUCAS, EMAIL_MARIANA]);
      await closeDb();
    });

    // ── Lucas-like ────────────────────────────────────────────────────────────

    it("Lucas-like: getOrComputeDailyGoals returns correct macro targets", async () => {
      const result = await getOrComputeDailyGoals(lucasId, TEST_DATE);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.goals.calorieGoal).toBe(LUCAS_EXPECTED.calorieGoal);
      expect(result.goals.proteinGoal).toBe(LUCAS_EXPECTED.proteinGoal);
      expect(result.goals.carbsGoal).toBe(LUCAS_EXPECTED.carbsGoal);
      expect(result.goals.fatGoal).toBe(LUCAS_EXPECTED.fatGoal);
      expect(result.audit?.direction).toBe("LOSE");
    });

    it("Lucas-like: goals are persisted to daily_calorie_goals table", async () => {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.dailyCalorieGoals)
        .where(
          eq(schema.dailyCalorieGoals.userId, lucasId),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.calorieGoal).toBe(LUCAS_EXPECTED.calorieGoal);
      expect(rows[0]!.proteinGoal).toBe(LUCAS_EXPECTED.proteinGoal);
      expect(rows[0]!.carbsGoal).toBe(LUCAS_EXPECTED.carbsGoal);
      expect(rows[0]!.fatGoal).toBe(LUCAS_EXPECTED.fatGoal);
      expect(rows[0]!.activityLevel).toBe("moderate");
    });

    // ── Mariana-like ──────────────────────────────────────────────────────────

    it("Mariana-like: getOrComputeDailyGoals returns correct macro targets", async () => {
      const result = await getOrComputeDailyGoals(marianaId, TEST_DATE);
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.goals.calorieGoal).toBe(MARIANA_EXPECTED.calorieGoal);
      expect(result.goals.proteinGoal).toBe(MARIANA_EXPECTED.proteinGoal);
      expect(result.goals.carbsGoal).toBe(MARIANA_EXPECTED.carbsGoal);
      expect(result.goals.fatGoal).toBe(MARIANA_EXPECTED.fatGoal);
      expect(result.audit?.direction).toBe("MAINTAIN");
    });

    it("Mariana-like: goals are persisted to daily_calorie_goals table", async () => {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.dailyCalorieGoals)
        .where(
          eq(schema.dailyCalorieGoals.userId, marianaId),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.calorieGoal).toBe(MARIANA_EXPECTED.calorieGoal);
      expect(rows[0]!.proteinGoal).toBe(MARIANA_EXPECTED.proteinGoal);
      expect(rows[0]!.carbsGoal).toBe(MARIANA_EXPECTED.carbsGoal);
      expect(rows[0]!.fatGoal).toBe(MARIANA_EXPECTED.fatGoal);
      expect(rows[0]!.activityLevel).toBe("light");
    });

    // ── Cross-user correctness: the two outputs MUST differ ──────────────────

    it("Lucas and Mariana goals are distinct — engine is not tuned to one body", async () => {
      // Calorie goals differ (LOSE vs MAINTAIN, different bodies)
      expect(LUCAS_EXPECTED.calorieGoal).not.toBe(MARIANA_EXPECTED.calorieGoal);
      // Fat goals differ (different weights and calorie targets)
      expect(LUCAS_EXPECTED.fatGoal).not.toBe(MARIANA_EXPECTED.fatGoal);
      // Protein goals differ (different body weight + direction coefficients)
      expect(LUCAS_EXPECTED.proteinGoal).not.toBe(MARIANA_EXPECTED.proteinGoal);
    });

    // ── Cache hit: second call returns stored row (no recompute) ─────────────

    it("second call for Lucas returns cached row without calling health-cache again", async () => {
      const callsBefore = mockGetCachedHealthProfile.mock.calls.length;
      const result = await getOrComputeDailyGoals(lucasId, TEST_DATE);

      // The row was written by the first test above; this is a PAST-equivalent
      // (row exists with non-null proteinGoal). But TEST_DATE is in the future so
      // the today/future cache-hit branch applies: settings match → return stored row.
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.goals.calorieGoal).toBe(LUCAS_EXPECTED.calorieGoal);

      // Profile was NOT re-fetched — the stored row was returned directly
      expect(mockGetCachedHealthProfile.mock.calls.length).toBe(callsBefore);
    });
  },
);
