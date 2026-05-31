import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { users, sessions, healthTokens, customFoods, foodLogEntries, dailyCalorieGoals } from "@/db/schema";

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

  describe("healthTokens table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(healthTokens);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("healthUserId");
      expect(columns).toHaveProperty("accessToken");
      expect(columns).toHaveProperty("refreshToken");
      expect(columns).toHaveProperty("expiresAt");
      expect(columns).toHaveProperty("scope");
      expect(columns).toHaveProperty("updatedAt");
    });

    it("has notNull userId column referencing users", () => {
      const columns = getTableColumns(healthTokens);
      expect(columns.userId).toBeDefined();
      expect(columns.userId.dataType).toBe("string");
      expect(columns.userId.notNull).toBe(true);
    });

    it("no longer exports fitbitTokens", async () => {
      const schema = await import("@/db/schema");
      expect(schema).not.toHaveProperty("fitbitTokens");
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
      expect(columns).toHaveProperty("confidence");
      expect(columns).toHaveProperty("notes");
      expect(columns).toHaveProperty("createdAt");
    });

    it("unitId is a text column (serving-unit string)", () => {
      const columns = getTableColumns(customFoods);
      expect(columns.unitId.dataType).toBe("string");
    });

    it("no longer has fitbitFoodId (FOO-1077 — dropped)", () => {
      const columns = getTableColumns(customFoods) as Record<string, unknown>;
      expect(columns).not.toHaveProperty("fitbitFoodId");
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
      expect(columns).toHaveProperty("healthLogId");
      expect(columns).toHaveProperty("mealTypeId");
      expect(columns).toHaveProperty("amount");
      expect(columns).toHaveProperty("unitId");
      expect(columns).toHaveProperty("date");
      expect(columns).toHaveProperty("time");
      expect(columns).toHaveProperty("loggedAt");
    });

    it("healthLogId is a nullable text column, fitbitLogId is gone (FOO-1077)", () => {
      const columns = getTableColumns(foodLogEntries) as Record<string, { dataType?: string; notNull?: boolean }>;
      expect(columns).not.toHaveProperty("fitbitLogId");
      expect(columns.healthLogId.dataType).toBe("string");
      expect(columns.healthLogId.notNull).toBe(false);
    });

    it("unitId is a text column (serving-unit string)", () => {
      const columns = getTableColumns(foodLogEntries);
      expect(columns.unitId.dataType).toBe("string");
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

  it("does not export fitbitCredentials (FOO-1076 — table dropped)", async () => {
    const schema = await import("@/db/schema");
    expect(schema).not.toHaveProperty("fitbitCredentials");
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

describe("users table — weightGoalType (FOO-1079)", () => {
  it("has a nullable weightGoalType text column", () => {
    const columns = getTableColumns(users);
    expect(columns).toHaveProperty("weightGoalType");
    expect(columns.weightGoalType.dataType).toBe("string");
    expect(columns.weightGoalType.notNull).toBe(false);
  });

  it("constrains weightGoalType to LOSE/MAINTAIN/GAIN via CHECK", () => {
    const cfg = getTableConfig(users);
    const names = cfg.checks.map((c) => c.name);
    expect(names).toContain("users_weight_goal_type_chk");
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

// ─── FOO-1078: performance indexes + checks + partial unique index ────────────

describe("performance indexes, checks, partial unique index (FOO-1078)", () => {
  it("food_log_entries has user-date and custom-food indexes", () => {
    const cfg = getTableConfig(foodLogEntries);
    const byName = new Map(cfg.indexes.map((i) => [i.config.name, i]));
    expect(byName.has("food_log_entries_user_date_idx")).toBe(true);
    expect(byName.has("food_log_entries_custom_food_idx")).toBe(true);

    const userDate = byName.get("food_log_entries_user_date_idx")!;
    expect(userDate.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "user_id",
      "date",
    ]);

    const customFood = byName.get("food_log_entries_custom_food_idx")!;
    expect(customFood.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "custom_food_id",
    ]);
  });

  it("food_log_entries has a partial unique index on (user_id, health_log_id)", () => {
    const cfg = getTableConfig(foodLogEntries);
    const uniq = cfg.indexes.find((i) => i.config.name === "food_log_entries_user_health_log_uniq");
    expect(uniq).toBeDefined();
    expect(uniq!.config.unique).toBe(true);
    expect(uniq!.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "user_id",
      "health_log_id",
    ]);
    // Non-empty partial WHERE clause (health_log_id IS NOT NULL)
    expect(uniq!.config.where).toBeDefined();
  });

  it("custom_foods has a user index", () => {
    const cfg = getTableConfig(customFoods);
    const names = cfg.indexes.map((i) => i.config.name);
    expect(names).toContain("custom_foods_user_idx");
  });

  it("daily_calorie_goals has an activity_level CHECK", () => {
    const cfg = getTableConfig(dailyCalorieGoals);
    const names = cfg.checks.map((c) => c.name);
    expect(names).toContain("daily_calorie_goals_activity_level_chk");
  });
});
