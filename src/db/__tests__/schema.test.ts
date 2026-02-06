import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { sessions, fitbitTokens, foodLogs } from "@/db/schema";

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

  describe("foodLogs table", () => {
    it("has expected columns", () => {
      const columns = getTableColumns(foodLogs);
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
      expect(columns).toHaveProperty("confidence");
      expect(columns).toHaveProperty("notes");
      expect(columns).toHaveProperty("mealTypeId");
      expect(columns).toHaveProperty("date");
      expect(columns).toHaveProperty("time");
      expect(columns).toHaveProperty("fitbitFoodId");
      expect(columns).toHaveProperty("fitbitLogId");
      expect(columns).toHaveProperty("loggedAt");
    });
  });
});
