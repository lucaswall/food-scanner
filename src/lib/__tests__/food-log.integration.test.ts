/**
 * Integration: food-log cross-user isolation
 *
 * Proves that all userId-scoped food-log operations (read, write, delete,
 * toggle, share-token) are strictly isolated between users — user B can never
 * read, modify, or delete user A's records, and vice versa.
 *
 * PRE-CONDITIONS (lead must complete before running):
 *   1. Start a throwaway Postgres instance (e.g. Docker).
 *   2. Apply the current schema: `DATABASE_URL="$INTEGRATION_DATABASE_URL" npx drizzle-kit push`
 *      (do NOT run the committed drizzle/ migration files — they are stale pending Task 29).
 *   3. Run: `INTEGRATION_DATABASE_URL=<url> npm run test:integration`
 *
 * IMPORTANT: INTEGRATION_DATABASE_URL must point at a DEDICATED throwaway DB —
 * never at DATABASE_URL (dev/prod). This file overrides DATABASE_URL for the
 * entire process so getDb() connects to the integration instance.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, or } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getDb, closeDb } from "@/db/index";
import {
  insertCustomFood,
  insertFoodLogEntry,
  getCustomFoodById,
  getFoodLogEntry,
  getFoodLogEntryDetail,
  deleteFoodLogEntry,
  updateFoodLogEntry,
  toggleFavorite,
  setShareToken,
} from "@/lib/food-log";

// ─── Guard + DATABASE_URL override ───────────────────────────────────────────
// Set DATABASE_URL to INTEGRATION_DATABASE_URL BEFORE any getDb() call so the
// lazy singleton picks it up. This file only runs inside the `test:integration`
// vitest project (a separate process), so it never contaminates dev/prod.
const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
if (INTEGRATION_DATABASE_URL) {
  process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;
}

// Unique email handles for this suite — `.invalid` TLD is RFC-2606 reserved.
const EMAIL_A = "userA@food-log-integration.invalid";
const EMAIL_B = "userB@food-log-integration.invalid";

describe.skipIf(!INTEGRATION_DATABASE_URL)(
  "food-log: cross-user isolation (integration)",
  () => {
    let userAId = "";
    let userBId = "";
    let foodAId = 0;
    let entryAId = 0;
    let foodBId = 0;
    let entryBId = 0;

    /**
     * Delete all test data in FK-safe order (food_log_entries → custom_foods → users).
     * Called in beforeAll (to remove stale data from a crashed previous run) and
     * in afterAll (normal teardown).
     */
    async function cleanup(): Promise<void> {
      const db = getDb();
      const staleUsers = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(or(eq(schema.users.email, EMAIL_A), eq(schema.users.email, EMAIL_B)));

      if (staleUsers.length === 0) return;

      const staleIds = staleUsers.map((u) => u.id);
      for (const uid of staleIds) {
        await db.delete(schema.foodLogEntries).where(eq(schema.foodLogEntries.userId, uid));
        await db.delete(schema.customFoods).where(eq(schema.customFoods.userId, uid));
        await db.delete(schema.users).where(eq(schema.users.id, uid));
      }
    }

    beforeAll(async () => {
      // Remove any stale data from a previous crashed run
      await cleanup();

      const db = getDb();

      // Seed user A
      const [rowA] = await db
        .insert(schema.users)
        .values({ email: EMAIL_A, name: "Integration User A" })
        .returning({ id: schema.users.id });
      userAId = rowA!.id;

      // Seed user B
      const [rowB] = await db
        .insert(schema.users)
        .values({ email: EMAIL_B, name: "Integration User B" })
        .returning({ id: schema.users.id });
      userBId = rowB!.id;

      // Custom food for user A
      const foodA = await insertCustomFood(userAId, {
        foodName: "UserA Banana",
        amount: 100,
        unitId: "g",
        calories: 89,
        proteinG: 1.1,
        carbsG: 22.8,
        fatG: 0.3,
        fiberG: 2.6,
        sodiumMg: 1,
        confidence: "high",
        notes: null,
      });
      foodAId = foodA.id;

      // Log entry for user A
      const entryA = await insertFoodLogEntry(userAId, {
        customFoodId: foodAId,
        mealTypeId: 1,
        amount: 100,
        unitId: "g",
        date: "2030-01-01",
        time: "08:00:00",
      });
      entryAId = entryA.id;

      // Custom food for user B
      const foodB = await insertCustomFood(userBId, {
        foodName: "UserB Apple",
        amount: 182,
        unitId: "g",
        calories: 95,
        proteinG: 0.5,
        carbsG: 25,
        fatG: 0.3,
        fiberG: 4.4,
        sodiumMg: 2,
        confidence: "high",
        notes: null,
      });
      foodBId = foodB.id;

      // Log entry for user B
      const entryB = await insertFoodLogEntry(userBId, {
        customFoodId: foodBId,
        mealTypeId: 3,
        amount: 182,
        unitId: "g",
        date: "2030-01-01",
        time: "12:00:00",
      });
      entryBId = entryB.id;
    });

    afterAll(async () => {
      await cleanup();
      await closeDb();
    });

    // ─── Cross-user isolation: user B trying to access user A's data ──────────

    it("getCustomFoodById: user B cannot read user A's food", async () => {
      const result = await getCustomFoodById(userBId, foodAId);
      expect(result).toBeNull();
    });

    it("getFoodLogEntry: user B cannot read user A's entry", async () => {
      const result = await getFoodLogEntry(userBId, entryAId);
      expect(result).toBeNull();
    });

    it("getFoodLogEntryDetail: user B cannot read user A's entry detail", async () => {
      const result = await getFoodLogEntryDetail(userBId, entryAId);
      expect(result).toBeNull();
    });

    it("toggleFavorite: user B cannot toggle user A's food", async () => {
      const result = await toggleFavorite(userBId, foodAId);
      expect(result).toBeNull();

      // A's food must be unmodified (isFavorite still false)
      const aFood = await getCustomFoodById(userAId, foodAId);
      expect(aFood!.isFavorite).toBe(false);
    });

    it("setShareToken: user B cannot set share token on user A's food", async () => {
      const result = await setShareToken(userBId, foodAId);
      expect(result).toBeNull();

      // A's food must still have no share token
      const aFood = await getCustomFoodById(userAId, foodAId);
      expect(aFood!.shareToken).toBeNull();
    });

    it("deleteFoodLogEntry: user B cannot delete user A's entry", async () => {
      const result = await deleteFoodLogEntry(userBId, entryAId);
      expect(result).toBeNull();

      // A's entry must still exist
      const stillThere = await getFoodLogEntry(userAId, entryAId);
      expect(stillThere).not.toBeNull();
    });

    it("updateFoodLogEntry: user B cannot update user A's entry", async () => {
      const result = await updateFoodLogEntry(userBId, entryAId, {
        foodName: "Tampered By B",
        amount: 999,
        unitId: "g",
        calories: 999,
        proteinG: 99,
        carbsG: 99,
        fatG: 99,
        fiberG: 9,
        sodiumMg: 9,
        confidence: "high",
        notes: null,
        mealTypeId: 5,
        date: "2030-06-01",
        time: "20:00:00",
      });
      expect(result).toBeNull();

      // A's entry + food must be unchanged
      const aDetail = await getFoodLogEntryDetail(userAId, entryAId);
      expect(aDetail).not.toBeNull();
      expect(aDetail!.foodName).toBe("UserA Banana");
      expect(aDetail!.date).toBe("2030-01-01");
    });

    // ─── Positive: each user can access their own data ────────────────────────

    it("getCustomFoodById: user A can read their own food", async () => {
      const result = await getCustomFoodById(userAId, foodAId);
      expect(result).not.toBeNull();
      expect(result!.foodName).toBe("UserA Banana");
    });

    it("getCustomFoodById: user B can read their own food", async () => {
      const result = await getCustomFoodById(userBId, foodBId);
      expect(result).not.toBeNull();
      expect(result!.foodName).toBe("UserB Apple");
    });

    it("getFoodLogEntryDetail: user A can read their own entry", async () => {
      const result = await getFoodLogEntryDetail(userAId, entryAId);
      expect(result).not.toBeNull();
      expect(result!.foodName).toBe("UserA Banana");
    });

    // ─── Integrity: A's data is fully intact after all cross-user calls ───────

    it("user A's food and entry are intact after all isolation tests", async () => {
      const food = await getCustomFoodById(userAId, foodAId);
      expect(food).not.toBeNull();
      expect(food!.foodName).toBe("UserA Banana");
      expect(food!.isFavorite).toBe(false);
      expect(food!.shareToken).toBeNull();

      const entry = await getFoodLogEntryDetail(userAId, entryAId);
      expect(entry).not.toBeNull();
      expect(entry!.foodName).toBe("UserA Banana");
      expect(entry!.date).toBe("2030-01-01");
    });
  }
);
