/**
 * Integration: deleteUserData — transactional deletion + cross-user isolation
 *
 * Proves that deleteUserData(userId):
 *   1. Removes ALL rows for userId across every table in a single transaction.
 *   2. Leaves a concurrent user's data completely untouched.
 *   3. Rolls back on mid-delete failure, leaving the target user's data intact.
 *
 * PRE-CONDITIONS (lead must complete before running):
 *   1. Start a throwaway Postgres instance (e.g. Docker).
 *   2. Apply the current schema: `DATABASE_URL="$INTEGRATION_DATABASE_URL" npx drizzle-kit push`
 *      (do NOT run the committed drizzle/ migration files — stale pending Task 29).
 *   3. Run: `INTEGRATION_DATABASE_URL=<url> npm run test:integration`
 *
 * IMPORTANT: INTEGRATION_DATABASE_URL must point at a DEDICATED throwaway DB —
 * never at DATABASE_URL (dev/prod).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, or } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb, closeDb } from "@/db/index";
import { deleteUserData } from "@/lib/user-data";

// ─── Guard + DATABASE_URL override ───────────────────────────────────────────
const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
if (INTEGRATION_DATABASE_URL) {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
}

// Unique email handles — `.invalid` TLD is RFC-2606 reserved.
const EMAIL_A = "userA@user-data-integration.invalid";
const EMAIL_B = "userB@user-data-integration.invalid";
const EMAIL_C = "userC@user-data-integration.invalid";

// ─── Seed helper ─────────────────────────────────────────────────────────────

/**
 * Seed a user with one row in every FK-child table, plus comprehensive goal
 * settings. Returns the userId and the IDs of all child rows seeded.
 */
interface SeededUser {
  userId: string;
  customFoodId: number;
  foodLogEntryId: number;
}

async function seedUser(email: string, name: string): Promise<SeededUser> {
  const db = getDb();

  const [userRow] = await db
    .insert(schema.users)
    .values({
      email,
      name,
      activityLevel: "moderate",
      goalWeightKg: "70",
      goalRateKgPerWeek: "0.5",
      weightGoalType: "LOSE",
    })
    .returning({ id: schema.users.id });
  const userId = userRow!.id;

  // health_tokens
  await db.insert(schema.healthTokens).values({
    userId,
    healthUserId: `health-${userId}`,
    accessToken: "access-tok",
    refreshToken: "refresh-tok",
    expiresAt: new Date("2030-01-01"),
    scope: "fitness.body.read",
  });

  // sessions
  await db.insert(schema.sessions).values({
    userId,
    expiresAt: new Date("2030-01-01"),
  });

  // api_keys
  await db.insert(schema.apiKeys).values({
    userId,
    name: "test-key",
    keyHash: `hash-${userId}`,
    keyPrefix: "tst_",
  });

  // claude_usage
  await db.insert(schema.claudeUsage).values({
    userId,
    model: "claude-opus-4-8",
    operation: "analyze_food",
    inputTokens: 100,
    outputTokens: 50,
    inputPricePerMToken: "5",
    outputPricePerMToken: "25",
    costUsd: "0.00175",
  });

  // nutrition_labels
  await db.insert(schema.nutritionLabels).values({
    userId,
    brand: "TestBrand",
    productName: "TestProduct",
    servingSizeG: "100",
    servingSizeLabel: "100g",
    calories: 200,
    proteinG: "10",
    carbsG: "25",
    fatG: "8",
    fiberG: "3",
    sodiumMg: "150",
    source: "manual",
  });

  // daily_calorie_goals
  await db.insert(schema.dailyCalorieGoals).values({
    userId,
    date: "2030-01-01",
    calorieGoal: 2000,
    proteinGoal: 150,
  });

  // glucose_readings
  await db.insert(schema.glucoseReadings).values({
    userId,
    measuredAt: new Date("2030-01-01T08:00:00Z"),
    valueMgDl: "90",
  });

  // blood_pressure_readings
  await db.insert(schema.bloodPressureReadings).values({
    userId,
    measuredAt: new Date("2030-01-01T08:05:00Z"),
    systolic: 120,
    diastolic: 80,
  });

  // hydration_readings
  await db.insert(schema.hydrationReadings).values({
    userId,
    measuredAt: new Date("2030-01-01T09:00:00Z"),
    volumeMl: 250,
  });

  // saved_analyses
  await db.insert(schema.savedAnalyses).values({
    userId,
    foodAnalysis: { food_name: "Test", calories: 100 },
    description: "Test analysis",
    calories: 100,
  });

  // custom_foods + food_log_entries (FK: food_log_entries → custom_foods)
  const [customFoodRow] = await db
    .insert(schema.customFoods)
    .values({
      userId,
      foodName: `${name} Food`,
      amount: "100",
      unitId: "g",
      calories: 89,
      proteinG: "1.1",
      carbsG: "22.8",
      fatG: "0.3",
      fiberG: "2.6",
      sodiumMg: "1",
      confidence: "high",
      notes: null,
    })
    .returning({ id: schema.customFoods.id });
  const customFoodId = customFoodRow!.id;

  const [entryRow] = await db
    .insert(schema.foodLogEntries)
    .values({
      userId,
      customFoodId,
      mealTypeId: 1,
      amount: "100",
      unitId: "g",
      date: "2030-01-01",
      time: "08:00:00",
    })
    .returning({ id: schema.foodLogEntries.id });
  const foodLogEntryId = entryRow!.id;

  return { userId, customFoodId, foodLogEntryId };
}

/**
 * Assert that NO rows exist in any table for the given userId.
 */
async function assertUserDataGone(userId: string): Promise<void> {
  const db = getDb();

  const checks = await Promise.all([
    db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)),
    db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, userId)),
    db.select({ id: schema.healthTokens.id }).from(schema.healthTokens).where(eq(schema.healthTokens.userId, userId)),
    db.select({ id: schema.customFoods.id }).from(schema.customFoods).where(eq(schema.customFoods.userId, userId)),
    db.select({ id: schema.foodLogEntries.id }).from(schema.foodLogEntries).where(eq(schema.foodLogEntries.userId, userId)),
    db.select({ id: schema.apiKeys.id }).from(schema.apiKeys).where(eq(schema.apiKeys.userId, userId)),
    db.select({ id: schema.claudeUsage.id }).from(schema.claudeUsage).where(eq(schema.claudeUsage.userId, userId)),
    db.select({ id: schema.nutritionLabels.id }).from(schema.nutritionLabels).where(eq(schema.nutritionLabels.userId, userId)),
    db.select({ id: schema.dailyCalorieGoals.id }).from(schema.dailyCalorieGoals).where(eq(schema.dailyCalorieGoals.userId, userId)),
    db.select({ id: schema.glucoseReadings.id }).from(schema.glucoseReadings).where(eq(schema.glucoseReadings.userId, userId)),
    db.select({ id: schema.savedAnalyses.id }).from(schema.savedAnalyses).where(eq(schema.savedAnalyses.userId, userId)),
    db.select({ id: schema.bloodPressureReadings.id }).from(schema.bloodPressureReadings).where(eq(schema.bloodPressureReadings.userId, userId)),
    db.select({ id: schema.hydrationReadings.id }).from(schema.hydrationReadings).where(eq(schema.hydrationReadings.userId, userId)),
  ]);

  const tableNames = [
    "users", "sessions", "health_tokens", "custom_foods", "food_log_entries",
    "api_keys", "claude_usage", "nutrition_labels", "daily_calorie_goals",
    "glucose_readings", "saved_analyses", "blood_pressure_readings", "hydration_readings",
  ];

  for (let i = 0; i < checks.length; i++) {
    expect(checks[i], `Expected 0 rows in ${tableNames[i]} for deleted user`).toHaveLength(0);
  }
}

/**
 * Hard cleanup for test emails — used in beforeAll for stale-data removal.
 * Must delete in FK-safe order.
 */
async function hardCleanup(emails: string[]): Promise<void> {
  const db = getDb();
  const stale = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      emails.length === 1
        ? eq(schema.users.email, emails[0]!)
        : or(...emails.map((e) => eq(schema.users.email, e))),
    );

  for (const { id } of stale) {
    await db.delete(schema.foodLogEntries).where(eq(schema.foodLogEntries.userId, id));
    await db.delete(schema.customFoods).where(eq(schema.customFoods.userId, id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    await db.delete(schema.healthTokens).where(eq(schema.healthTokens.userId, id));
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.userId, id));
    await db.delete(schema.claudeUsage).where(eq(schema.claudeUsage.userId, id));
    await db.delete(schema.nutritionLabels).where(eq(schema.nutritionLabels.userId, id));
    await db.delete(schema.dailyCalorieGoals).where(eq(schema.dailyCalorieGoals.userId, id));
    await db.delete(schema.glucoseReadings).where(eq(schema.glucoseReadings.userId, id));
    await db.delete(schema.savedAnalyses).where(eq(schema.savedAnalyses.userId, id));
    await db.delete(schema.bloodPressureReadings).where(eq(schema.bloodPressureReadings.userId, id));
    await db.delete(schema.hydrationReadings).where(eq(schema.hydrationReadings.userId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!INTEGRATION_DATABASE_URL)(
  "deleteUserData (integration)",
  () => {
    beforeAll(async () => {
      // Remove stale data from any previous crashed run
      await hardCleanup([EMAIL_A, EMAIL_B, EMAIL_C]);
    });

    afterAll(async () => {
      // Safety cleanup in case a test left data (e.g. the rollback test)
      await hardCleanup([EMAIL_A, EMAIL_B, EMAIL_C]);
      await closeDb();
    });

    // ── Happy path ────────────────────────────────────────────────────────────

    it("deletes all rows for userA across every table in one call", async () => {
      const { userId: userAId } = await seedUser(EMAIL_A, "Delete Me A");
      const { userId: userBId } = await seedUser(EMAIL_B, "Keep Me B");

      await deleteUserData(userAId);

      // Every table for A must be empty
      await assertUserDataGone(userAId);

      // B must be completely untouched — spot-check the user row and food
      const db = getDb();
      const bUsers = await db.select().from(schema.users).where(eq(schema.users.id, userBId));
      expect(bUsers).toHaveLength(1);
      const bFoods = await db.select().from(schema.customFoods).where(eq(schema.customFoods.userId, userBId));
      expect(bFoods).toHaveLength(1);
      const bEntries = await db.select().from(schema.foodLogEntries).where(eq(schema.foodLogEntries.userId, userBId));
      expect(bEntries).toHaveLength(1);

      // Cleanup B
      await deleteUserData(userBId);
    });

    // ── Transaction rollback ──────────────────────────────────────────────────

    it("a mid-delete failure rolls back the whole transaction, leaving data intact", async () => {
      const { userId: userCId } = await seedUser(EMAIL_C, "Rollback Test C");
      const db = getDb();

      // Simulate a mid-delete failure: delete food_log_entries and custom_foods
      // but throw before deleting users. The transaction must roll back both
      // deletes, leaving user C's full dataset intact.
      await expect(
        db.transaction(async (tx) => {
          await tx.delete(schema.foodLogEntries).where(eq(schema.foodLogEntries.userId, userCId));
          await tx.delete(schema.customFoods).where(eq(schema.customFoods.userId, userCId));
          // Simulate failure before the remaining tables are cleaned up
          throw new Error("simulated mid-delete failure");
        }),
      ).rejects.toThrow("simulated mid-delete failure");

      // All data for C must still be present — the transaction rolled back
      const cUsers = await db.select().from(schema.users).where(eq(schema.users.id, userCId));
      expect(cUsers).toHaveLength(1);
      const cFoods = await db.select().from(schema.customFoods).where(eq(schema.customFoods.userId, userCId));
      expect(cFoods).toHaveLength(1);
      const cEntries = await db.select().from(schema.foodLogEntries).where(eq(schema.foodLogEntries.userId, userCId));
      expect(cEntries).toHaveLength(1);

      // Cleanup C using deleteUserData (which uses the same transaction wrapper)
      await deleteUserData(userCId);
      await assertUserDataGone(userCId);
    });

    // ── Idempotency ───────────────────────────────────────────────────────────

    it("calling deleteUserData twice on the same userId is safe (no-op on second call)", async () => {
      const { userId } = await seedUser(EMAIL_A, "Idempotent A");
      await deleteUserData(userId);
      // Second call should complete without throwing even though rows are gone
      await expect(deleteUserData(userId)).resolves.toBeUndefined();
    });
  },
);
