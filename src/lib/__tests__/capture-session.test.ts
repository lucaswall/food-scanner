import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createCaptureSessionId,
  getActiveCaptureSessionId,
  saveCaptureMetadata,
  loadCaptureMetadata,
  saveCaptureBlobs,
  loadCaptureBlobs,
  deleteCaptureBlobs,
  deleteAllCaptureBlobs,
  clearCaptureSession,
  isCaptureSessionExpired,
  cleanupExpiredCaptures,
  _resetCaptureDBForTesting,
} from "@/lib/capture-session";
import { _resetDBForTesting } from "@/lib/analysis-session";
import type { CaptureSession } from "@/types";

function makeSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    id: "session-1",
    captures: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("capture-session", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetCaptureDBForTesting();
    _resetDBForTesting();
    indexedDB = new IDBFactory();
  });

  describe("localStorage session ID operations", () => {
    it("createCaptureSessionId creates UUID and stores in localStorage", () => {
      const id = createCaptureSessionId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(localStorage.getItem("food-scanner-capture-session-id")).toBe(id);
    });

    it("getActiveCaptureSessionId returns null when no session exists", () => {
      expect(getActiveCaptureSessionId()).toBeNull();
    });

    it("getActiveCaptureSessionId returns stored session ID", () => {
      localStorage.setItem("food-scanner-capture-session-id", "test-id");
      expect(getActiveCaptureSessionId()).toBe("test-id");
    });
  });

  describe("metadata operations", () => {
    it("saveCaptureMetadata + loadCaptureMetadata round-trips correctly", () => {
      const session = makeSession({ id: "sess-abc" });
      saveCaptureMetadata("sess-abc", session);
      const loaded = loadCaptureMetadata("sess-abc");
      expect(loaded).toEqual(session);
    });

    it("loadCaptureMetadata returns null for missing session", () => {
      expect(loadCaptureMetadata("nonexistent")).toBeNull();
    });

    it("loadCaptureMetadata returns null for corrupt data", () => {
      localStorage.setItem("food-scanner-capture-session:bad", "not-json{");
      expect(loadCaptureMetadata("bad")).toBeNull();
    });

    it("loadCaptureMetadata returns null for invalid shape", () => {
      localStorage.setItem("food-scanner-capture-session:bad", JSON.stringify({ foo: "bar" }));
      expect(loadCaptureMetadata("bad")).toBeNull();
    });
  });

  describe("IndexedDB blob operations", () => {
    it("saveCaptureBlobs + loadCaptureBlobs round-trips blob arrays", async () => {
      const blobs = [new Blob(["img1"], { type: "image/jpeg" }), new Blob(["img2"], { type: "image/jpeg" })];
      await saveCaptureBlobs("session-1", "capture-1", blobs);
      const loaded = await loadCaptureBlobs("session-1", "capture-1");
      expect(loaded).toHaveLength(2);
    });

    it("loadCaptureBlobs returns empty array when not found", async () => {
      const loaded = await loadCaptureBlobs("session-x", "capture-x");
      expect(loaded).toEqual([]);
    });

    it("deleteCaptureBlobs removes specific capture blobs", async () => {
      await saveCaptureBlobs("session-1", "capture-1", [new Blob(["img1"])]);
      await saveCaptureBlobs("session-1", "capture-2", [new Blob(["img2"])]);
      await deleteCaptureBlobs("session-1", "capture-1");
      expect(await loadCaptureBlobs("session-1", "capture-1")).toEqual([]);
      expect(await loadCaptureBlobs("session-1", "capture-2")).toHaveLength(1);
    });

    it("deleteAllCaptureBlobs removes all blobs for a session", async () => {
      await saveCaptureBlobs("session-1", "capture-1", [new Blob(["img1"])]);
      await saveCaptureBlobs("session-1", "capture-2", [new Blob(["img2"])]);
      await saveCaptureBlobs("session-2", "capture-1", [new Blob(["img3"])]);
      await deleteAllCaptureBlobs("session-1");
      expect(await loadCaptureBlobs("session-1", "capture-1")).toEqual([]);
      expect(await loadCaptureBlobs("session-1", "capture-2")).toEqual([]);
      // session-2 blobs should be untouched
      expect(await loadCaptureBlobs("session-2", "capture-1")).toHaveLength(1);
    });
  });

  describe("session lifecycle", () => {
    it("clearCaptureSession removes both metadata and blobs", async () => {
      const session = makeSession({ id: "session-1" });
      saveCaptureMetadata("session-1", session);
      localStorage.setItem("food-scanner-capture-session-id", "session-1");
      await saveCaptureBlobs("session-1", "capture-1", [new Blob(["img"])]);

      await clearCaptureSession("session-1");

      expect(loadCaptureMetadata("session-1")).toBeNull();
      expect(localStorage.getItem("food-scanner-capture-session-id")).toBeNull();
      expect(await loadCaptureBlobs("session-1", "capture-1")).toEqual([]);
    });
  });

  describe("TTL expiry", () => {
    it("isCaptureSessionExpired returns false for fresh session", () => {
      const session = makeSession({ createdAt: new Date().toISOString() });
      expect(isCaptureSessionExpired(session)).toBe(false);
    });

    it("isCaptureSessionExpired returns true for 7+ day old session", () => {
      const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const session = makeSession({ createdAt: old });
      expect(isCaptureSessionExpired(session)).toBe(true);
    });

    it("cleanupExpiredCaptures returns 0 when no session exists", async () => {
      const result = await cleanupExpiredCaptures();
      expect(result.expiredCount).toBe(0);
    });

    it("cleanupExpiredCaptures clears expired session and returns count", async () => {
      const id = createCaptureSessionId();
      const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const session: CaptureSession = { id, captures: [{ id: "c1", imageCount: 1, note: null, capturedAt: new Date().toISOString(), order: 0 }], createdAt: old };
      saveCaptureMetadata(id, session);
      await saveCaptureBlobs(id, "c1", [new Blob(["img"])]);

      const result = await cleanupExpiredCaptures();

      expect(result.expiredCount).toBe(1);
      expect(getActiveCaptureSessionId()).toBeNull();
      expect(loadCaptureMetadata(id)).toBeNull();
    });

    it("cleanupExpiredCaptures returns 0 for non-expired session", async () => {
      const id = createCaptureSessionId();
      saveCaptureMetadata(id, makeSession({ id }));

      const result = await cleanupExpiredCaptures();
      expect(result.expiredCount).toBe(0);
      expect(getActiveCaptureSessionId()).toBe(id);
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

    it("saveCaptureBlobs silently succeeds when IndexedDB unavailable", async () => {
      await expect(saveCaptureBlobs("s1", "c1", [new Blob(["img"])])).resolves.toBeUndefined();
    });

    it("loadCaptureBlobs returns empty array when IndexedDB unavailable", async () => {
      expect(await loadCaptureBlobs("s1", "c1")).toEqual([]);
    });
  });

  describe("localStorage mock", () => {
    it("getActiveCaptureSessionId returns null on localStorage error", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
        throw new Error("storage error");
      });
      expect(getActiveCaptureSessionId()).toBeNull();
    });
  });
});
