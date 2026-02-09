import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  savePendingSubmission,
  getPendingSubmission,
  clearPendingSubmission,
} from "../pending-submission";
import type { PendingSubmission } from "../pending-submission";
import type { FoodAnalysis } from "@/types";

const mockAnalysis: FoodAnalysis = {
  food_name: "Empanada de carne",
  amount: 150,
  unit_id: 147,
  calories: 320,
  protein_g: 12,
  carbs_g: 28,
  fat_g: 18,
  fiber_g: 2,
  sodium_mg: 450,
  confidence: "high",
  notes: "Standard beef empanada",
  description: "A golden-brown baked empanada",
  keywords: ["empanada", "carne"],
};

const mockPending: PendingSubmission = {
  analysis: mockAnalysis,
  mealTypeId: 3,
  foodName: "Empanada de carne",
};

describe("pending-submission", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe("savePendingSubmission", () => {
    it("stores data to sessionStorage under the correct key", () => {
      savePendingSubmission(mockPending);

      const stored = sessionStorage.getItem("food-scanner-pending-submission");
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(mockPending);
    });
  });

  describe("getPendingSubmission", () => {
    it("returns the stored data", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify(mockPending)
      );

      const result = getPendingSubmission();
      expect(result).toEqual(mockPending);
    });

    it("returns null when no data is stored", () => {
      const result = getPendingSubmission();
      expect(result).toBeNull();
    });

    it("returns null when stored data is invalid JSON", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        "not valid json"
      );

      const result = getPendingSubmission();
      expect(result).toBeNull();
    });
  });

  describe("clearPendingSubmission", () => {
    it("removes data from sessionStorage", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify(mockPending)
      );

      clearPendingSubmission();

      expect(
        sessionStorage.getItem("food-scanner-pending-submission")
      ).toBeNull();
    });
  });

  describe("sessionStorage unavailable", () => {
    it("savePendingSubmission does not throw when sessionStorage throws", () => {
      const spy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("sessionStorage unavailable");
        });

      expect(() => savePendingSubmission(mockPending)).not.toThrow();

      spy.mockRestore();
    });

    it("getPendingSubmission returns null when sessionStorage throws", () => {
      const spy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("sessionStorage unavailable");
        });

      expect(getPendingSubmission()).toBeNull();

      spy.mockRestore();
    });

    it("clearPendingSubmission does not throw when sessionStorage throws", () => {
      const spy = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation(() => {
          throw new Error("sessionStorage unavailable");
        });

      expect(() => clearPendingSubmission()).not.toThrow();

      spy.mockRestore();
    });
  });

  describe("reuse flow", () => {
    it("stores and retrieves pending submission with reuseCustomFoodId", () => {
      const reusePending: PendingSubmission = {
        analysis: null,
        mealTypeId: 5,
        foodName: "Empanada de carne",
        reuseCustomFoodId: 42,
      };

      savePendingSubmission(reusePending);

      const result = getPendingSubmission();
      expect(result).toEqual(reusePending);
      expect(result?.reuseCustomFoodId).toBe(42);
      expect(result?.analysis).toBeNull();
    });
  });

  describe("runtime validation", () => {
    it("returns null for empty object", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify({})
      );
      expect(getPendingSubmission()).toBeNull();
    });

    it("returns null when mealTypeId is missing", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify({ analysis: null, foodName: "Test" })
      );
      expect(getPendingSubmission()).toBeNull();
    });

    it("returns null when mealTypeId is not a number", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify({ analysis: null, mealTypeId: "three", foodName: "Test" })
      );
      expect(getPendingSubmission()).toBeNull();
    });

    it("returns null when foodName is not a string", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify({ analysis: null, mealTypeId: 3, foodName: 123 })
      );
      expect(getPendingSubmission()).toBeNull();
    });

    it("returns null when analysis has wrong shape (missing food_name)", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify({
          analysis: { calories: 100 },
          mealTypeId: 3,
          foodName: "Test",
        })
      );
      expect(getPendingSubmission()).toBeNull();
    });

    it("returns null when analysis has wrong shape (missing calories)", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify({
          analysis: { food_name: "Test" },
          mealTypeId: 3,
          foodName: "Test",
        })
      );
      expect(getPendingSubmission()).toBeNull();
    });

    it("returns null when reuseCustomFoodId is present but not a number", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify({
          analysis: null,
          mealTypeId: 3,
          foodName: "Test",
          reuseCustomFoodId: "abc",
        })
      );
      expect(getPendingSubmission()).toBeNull();
    });

    it("accepts valid data with null analysis", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify({
          analysis: null,
          mealTypeId: 3,
          foodName: "Test",
        })
      );
      const result = getPendingSubmission();
      expect(result).not.toBeNull();
      expect(result?.foodName).toBe("Test");
    });

    it("accepts valid data with full analysis", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify(mockPending)
      );
      const result = getPendingSubmission();
      expect(result).not.toBeNull();
      expect(result?.analysis?.food_name).toBe("Empanada de carne");
    });

    it("accepts valid data with date and time strings", () => {
      sessionStorage.setItem(
        "food-scanner-pending-submission",
        JSON.stringify({
          ...mockPending,
          date: "2026-02-07",
          time: "14:30:00",
        })
      );
      const result = getPendingSubmission();
      expect(result).not.toBeNull();
      expect(result?.date).toBe("2026-02-07");
      expect(result?.time).toBe("14:30:00");
    });
  });
});
