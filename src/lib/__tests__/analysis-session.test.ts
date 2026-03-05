import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  saveSessionPhotos,
  loadSessionPhotos,
  saveSessionState,
  loadSessionState,
  clearSession,
  getActiveSessionId,
  createSessionId,
  isSessionExpired,
  cleanupExpiredSession,
} from "@/lib/analysis-session";
import type { AnalysisSessionState } from "@/lib/analysis-session";

function makeState(overrides: Partial<AnalysisSessionState> = {}): AnalysisSessionState {
  return {
    description: "Test meal",
    analysis: null,
    analysisNarrative: null,
    mealTypeId: 7,
    selectedTime: "12:30",
    matches: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("analysis-session", () => {
  beforeEach(() => {
    sessionStorage.clear();
    // Clear IndexedDB between tests
    indexedDB = new IDBFactory();
  });

  describe("IndexedDB photo operations", () => {
    it("saveSessionPhotos stores blobs and loadSessionPhotos returns them", async () => {
      const blobs = [new Blob(["photo1"], { type: "image/jpeg" }), new Blob(["photo2"], { type: "image/png" })];
      await saveSessionPhotos("session-1", blobs);
      const loaded = await loadSessionPhotos("session-1");
      expect(loaded).toHaveLength(2);
    });

    it("saveSessionPhotos with empty array stores empty array", async () => {
      await saveSessionPhotos("session-2", []);
      const loaded = await loadSessionPhotos("session-2");
      expect(loaded).toEqual([]);
    });

    it("loadSessionPhotos with nonexistent session returns empty array", async () => {
      const loaded = await loadSessionPhotos("nonexistent");
      expect(loaded).toEqual([]);
    });
  });

  describe("sessionStorage state operations", () => {
    it("saveSessionState stores state and loadSessionState returns it", () => {
      const state = makeState();
      saveSessionState("session-1", state);
      const loaded = loadSessionState("session-1");
      expect(loaded).toEqual(state);
    });

    it("state includes all expected fields", () => {
      const state = makeState({
        description: "Chicken salad",
        analysis: { food_name: "Chicken Salad", calories: 350, protein_g: 30, carbs_g: 10, fat_g: 20, fiber_g: 3, sodium_mg: 500, saturated_fat_g: null, trans_fat_g: null, sugars_g: null, calories_from_fat: null, confidence: "high", notes: "", description: "Chicken salad", keywords: ["chicken", "salad"], amount: 1, unit_id: 304 },
        analysisNarrative: "A healthy chicken salad",
        mealTypeId: 3,
        selectedTime: "18:00",
        matches: [{ customFoodId: 1, foodName: "Chicken Salad", calories: 350, proteinG: 30, carbsG: 10, fatG: 20, fitbitFoodId: null, matchRatio: 0.95, lastLoggedAt: "2026-03-01T12:00:00.000Z", amount: 1, unitId: 304 }],
      });
      saveSessionState("session-1", state);
      const loaded = loadSessionState("session-1");
      expect(loaded).toEqual(state);
    });

    it("loadSessionState with nonexistent session returns null", () => {
      const loaded = loadSessionState("nonexistent");
      expect(loaded).toBeNull();
    });

    it("loadSessionState with malformed JSON returns null", () => {
      sessionStorage.setItem("food-scanner-analysis-session:bad", "not json{");
      const loaded = loadSessionState("bad");
      expect(loaded).toBeNull();
    });

    it("loadSessionState with invalid shape returns null", () => {
      sessionStorage.setItem("food-scanner-analysis-session:invalid", JSON.stringify({ foo: "bar" }));
      const loaded = loadSessionState("invalid");
      expect(loaded).toBeNull();
    });
  });

  describe("session lifecycle", () => {
    it("clearSession removes from both IndexedDB and sessionStorage", async () => {
      const state = makeState();
      saveSessionState("session-1", state);
      await saveSessionPhotos("session-1", [new Blob(["photo"])]);

      await clearSession("session-1");

      expect(loadSessionState("session-1")).toBeNull();
      const photos = await loadSessionPhotos("session-1");
      expect(photos).toEqual([]);
    });

    it("getActiveSessionId returns current session ID from sessionStorage", () => {
      sessionStorage.setItem("food-scanner-session-id", "abc-123");
      expect(getActiveSessionId()).toBe("abc-123");
    });

    it("getActiveSessionId returns null when no session exists", () => {
      expect(getActiveSessionId()).toBeNull();
    });

    it("createSessionId generates a new UUID and stores it", () => {
      const id = createSessionId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(getActiveSessionId()).toBe(id);
    });
  });

  describe("TTL expiry", () => {
    it("isSessionExpired returns true if createdAt is older than 24 hours", () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const state = makeState({ createdAt: old });
      expect(isSessionExpired(state)).toBe(true);
    });

    it("isSessionExpired returns false if createdAt is within 24 hours", () => {
      const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      const state = makeState({ createdAt: recent });
      expect(isSessionExpired(state)).toBe(false);
    });

    it("cleanupExpiredSession clears active session if expired", async () => {
      const id = createSessionId();
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      saveSessionState(id, makeState({ createdAt: old }));
      await saveSessionPhotos(id, [new Blob(["photo"])]);

      await cleanupExpiredSession();

      expect(getActiveSessionId()).toBeNull();
      expect(loadSessionState(id)).toBeNull();
      const photos = await loadSessionPhotos(id);
      expect(photos).toEqual([]);
    });

    it("cleanupExpiredSession does nothing if session is not expired", async () => {
      const id = createSessionId();
      const state = makeState();
      saveSessionState(id, state);

      await cleanupExpiredSession();

      expect(getActiveSessionId()).toBe(id);
      expect(loadSessionState(id)).toEqual(state);
    });
  });

  describe("IndexedDB unavailable fallback", () => {
    let originalIndexedDB: IDBFactory;

    beforeEach(() => {
      originalIndexedDB = globalThis.indexedDB;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).indexedDB = undefined;
    });

    afterEach(() => {
      globalThis.indexedDB = originalIndexedDB;
    });

    it("saveSessionPhotos silently succeeds when IndexedDB unavailable", async () => {
      await expect(saveSessionPhotos("s1", [new Blob(["photo"])])).resolves.toBeUndefined();
    });

    it("loadSessionPhotos returns empty array when IndexedDB unavailable", async () => {
      const result = await loadSessionPhotos("s1");
      expect(result).toEqual([]);
    });
  });
});
