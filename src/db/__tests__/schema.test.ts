import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { users, sessions, fitbitTokens, customFoods, foodLogEntries, dailyCalorieGoals } from "@/db/schema";

describe("database schema", () => {
  describe("users table", () => {
    it("has expected columns with correct types", () => {
      const columns = getTableColumns(users);

      expect(columns.id).toBeDefined();
      expect(columns.id.dataType).toBe("string");
      expect(columns.id.notNull).toBe(true);

      expect(columns.email).toBeDefined();
      expect(columns.email.dataType).toBe("string");
      expect(columns.email.notNull).toBe(true);
      expect(columns.email.isUnique).toBe(true);

      expect(columns.name).toBeDefined();
      expect(columns.name.dataType).toBe("string");
      expect(columns.name.notNull).toBe(false);

      expect(columns.createdAt).toBeDefined();
      expect(columns.createdAt.dataType).toBe("date");
      expect(columns.createdAt.notNull).toBe(true);

      expect(columns.updatedAt).toBeDefined();
      expect(columns.updatedAt.dataType).toBe("date");
      expect(columns.updatedAt.notNull).toBe(true);
    });
  });

  describe("sessions table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(sessions);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("createdAt");
      expect(columns).toHaveProperty("expiresAt");
    });

    it("has userId column referencing users", () => {
      const columns = getTableColumns(sessions);
      expect(columns.userId).toBeDefined();
      expect(columns.userId.dataType).toBe("string");
      expect(columns.userId.notNull).toBe(true);
    });
  });

  describe("fitbitTokens table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(fitbitTokens);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("fitbitUserId");
      expect(columns).toHaveProperty("accessToken");
      expect(columns).toHaveProperty("refreshToken");
      expect(columns).toHaveProperty("expiresAt");
      expect(columns).toHaveProperty("updatedAt");
    });

    it("has userId column referencing users", () => {
      const columns = getTableColumns(fitbitTokens);
      expect(columns.userId).toBeDefined();
      expect(columns.userId.dataType).toBe("string");
      expect(columns.userId.notNull).toBe(true);
    });
  });

  describe("customFoods table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(customFoods);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("foodName");
      expect(columns).toHaveProperty("amount");
      expect(columns).toHaveProperty("unitId");
      expect(columns).toHaveProperty("calories");
      expect(columns).toHaveProperty("proteinG");
      expect(columns).toHaveProperty("carbsG");
      expect(columns).toHaveProperty("fatG");
      expect(columns).toHaveProperty("fiberG");
      expect(columns).toHaveProperty("sodiumMg");
      expect(columns).toHaveProperty("fitbitFoodId");
      expect(columns).toHaveProperty("confidence");
      expect(columns).toHaveProperty("notes");
      expect(columns).toHaveProperty("createdAt");
    });

    it("has a keywords column", () => {
      const columns = getTableColumns(customFoods);
      expect(columns).toHaveProperty("keywords");
    });

    it("has userId column referencing users", () => {
      const columns = getTableColumns(customFoods);
      expect(columns.userId).toBeDefined();
      expect(columns.userId.dataType).toBe("string");
      expect(columns.userId.notNull).toBe(true);
    });
  });

  describe("foodLogEntries table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(foodLogEntries);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("customFoodId");
      expect(columns).toHaveProperty("fitbitLogId");
      expect(columns).toHaveProperty("mealTypeId");
      expect(columns).toHaveProperty("amount");
      expect(columns).toHaveProperty("unitId");
      expect(columns).toHaveProperty("date");
      expect(columns).toHaveProperty("time");
      expect(columns).toHaveProperty("loggedAt");
    });

    it("has userId column referencing users", () => {
      const columns = getTableColumns(foodLogEntries);
      expect(columns.userId).toBeDefined();
      expect(columns.userId.dataType).toBe("string");
      expect(columns.userId.notNull).toBe(true);
    });
  });

  it("does not export lumenGoals (FOO-979 — table dropped)", async () => {
    const schema = await import("@/db/schema");
    expect(schema).not.toHaveProperty("lumenGoals");
  });

  it("does not export foodLogs", async () => {
    const schema = await import("@/db/schema");
    expect(schema).not.toHaveProperty("foodLogs");
  });
});

// ─── FOO-1040: goal-anchored columns ─────────────────────────────────────────

describe("users table — goal-anchored columns (FOO-1040)", () => {
  it("has activityLevel, goalWeightKg, goalRateKgPerWeek columns", () => {
    const columns = getTableColumns(users);
    expect(columns).toHaveProperty("activityLevel");
    expect(columns).toHaveProperty("goalWeightKg");
    expect(columns).toHaveProperty("goalRateKgPerWeek");
  });

  it("activityLevel is nullable text", () => {
    const columns = getTableColumns(users);
    expect(columns.activityLevel.dataType).toBe("string");
    expect(columns.activityLevel.notNull).toBe(false);
  });

  it("goalWeightKg is nullable numeric", () => {
    const columns = getTableColumns(users);
    expect(columns.goalWeightKg.dataType).toBe("string");
    expect(columns.goalWeightKg.notNull).toBe(false);
  });

  it("goalRateKgPerWeek is nullable numeric", () => {
    const columns = getTableColumns(users);
    expect(columns.goalRateKgPerWeek.dataType).toBe("string");
    expect(columns.goalRateKgPerWeek.notNull).toBe(false);
  });

  it("does NOT have macroProfile or macroProfileVersion columns", () => {
    const columns = getTableColumns(users) as Record<string, unknown>;
    expect(columns).not.toHaveProperty("macroProfile");
    expect(columns).not.toHaveProperty("macroProfileVersion");
  });
});

describe("dailyCalorieGoals table — goal-anchored columns (FOO-1040)", () => {
  it("has activityLevel, goalWeightKg, goalRateKgPerWeek, tdee, deficitKcal columns", () => {
    const columns = getTableColumns(dailyCalorieGoals);
    expect(columns).toHaveProperty("activityLevel");
    expect(columns).toHaveProperty("goalWeightKg");
    expect(columns).toHaveProperty("goalRateKgPerWeek");
    expect(columns).toHaveProperty("tdee");
    expect(columns).toHaveProperty("deficitKcal");
  });

  it("tdee is nullable integer", () => {
    const columns = getTableColumns(dailyCalorieGoals);
    expect(columns.tdee.dataType).toBe("number");
    expect(columns.tdee.notNull).toBe(false);
  });

  it("deficitKcal is nullable integer", () => {
    const columns = getTableColumns(dailyCalorieGoals);
    expect(columns.deficitKcal.dataType).toBe("number");
    expect(columns.deficitKcal.notNull).toBe(false);
  });

  it("does NOT have caloriesOut, activityKcal, bmiTier, goalType, profileVersion, tdeeSource", () => {
    const columns = getTableColumns(dailyCalorieGoals) as Record<string, unknown>;
    expect(columns).not.toHaveProperty("caloriesOut");
    expect(columns).not.toHaveProperty("activityKcal");
    expect(columns).not.toHaveProperty("bmiTier");
    expect(columns).not.toHaveProperty("goalType");
    expect(columns).not.toHaveProperty("profileVersion");
    expect(columns).not.toHaveProperty("tdeeSource");
  });
});
