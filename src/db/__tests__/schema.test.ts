import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { users, sessions, fitbitTokens, customFoods, foodLogEntries, lumenGoals } from "@/db/schema";

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

  describe("lumenGoals table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(lumenGoals);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("date");
      expect(columns).toHaveProperty("dayType");
      expect(columns).toHaveProperty("proteinGoal");
      expect(columns).toHaveProperty("carbsGoal");
      expect(columns).toHaveProperty("fatGoal");
      expect(columns).toHaveProperty("createdAt");
      expect(columns).toHaveProperty("updatedAt");
    });

    it("has userId column referencing users", () => {
      const columns = getTableColumns(lumenGoals);
      expect(columns.userId).toBeDefined();
      expect(columns.userId.dataType).toBe("string");
      expect(columns.userId.notNull).toBe(true);
    });

    it("has date column with correct type", () => {
      const columns = getTableColumns(lumenGoals);
      expect(columns.date).toBeDefined();
      expect(columns.date.dataType).toBe("string");
      expect(columns.date.notNull).toBe(true);
    });

    it("has integer goal columns", () => {
      const columns = getTableColumns(lumenGoals);
      expect(columns.proteinGoal.dataType).toBe("number");
      expect(columns.proteinGoal.notNull).toBe(true);
      expect(columns.carbsGoal.dataType).toBe("number");
      expect(columns.carbsGoal.notNull).toBe(true);
      expect(columns.fatGoal.dataType).toBe("number");
      expect(columns.fatGoal.notNull).toBe(true);
    });
  });

  it("does not export foodLogs", async () => {
    const schema = await import("@/db/schema");
    expect(schema).not.toHaveProperty("foodLogs");
  });
});
