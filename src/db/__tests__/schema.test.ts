import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { sessions, fitbitTokens, customFoods, foodLogEntries } from "@/db/schema";

describe("database schema", () => {
  describe("sessions table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(sessions);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("email");
      expect(columns).toHaveProperty("createdAt");
      expect(columns).toHaveProperty("expiresAt");
    });
  });

  describe("fitbitTokens table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(fitbitTokens);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("email");
      expect(columns).toHaveProperty("fitbitUserId");
      expect(columns).toHaveProperty("accessToken");
      expect(columns).toHaveProperty("refreshToken");
      expect(columns).toHaveProperty("expiresAt");
      expect(columns).toHaveProperty("updatedAt");
    });
  });

  describe("customFoods table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(customFoods);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("email");
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
  });

  describe("foodLogEntries table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(foodLogEntries);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("email");
      expect(columns).toHaveProperty("customFoodId");
      expect(columns).toHaveProperty("fitbitLogId");
      expect(columns).toHaveProperty("mealTypeId");
      expect(columns).toHaveProperty("amount");
      expect(columns).toHaveProperty("unitId");
      expect(columns).toHaveProperty("date");
      expect(columns).toHaveProperty("time");
      expect(columns).toHaveProperty("loggedAt");
    });
  });

  it("does not export foodLogs", async () => {
    const schema = await import("@/db/schema");
    expect(schema).not.toHaveProperty("foodLogs");
  });
});
