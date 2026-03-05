import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/analysis-session", () => ({
  getActiveSessionId: vi.fn(),
  createSessionId: vi.fn(),
  loadSessionState: vi.fn(),
  saveSessionState: vi.fn(),
  loadSessionPhotos: vi.fn(),
  saveSessionPhotos: vi.fn(),
  clearSession: vi.fn(),
  isSessionExpired: vi.fn(),
  cleanupExpiredSession: vi.fn(),
}));

import {
  getActiveSessionId,
  createSessionId,
  loadSessionState,
  saveSessionState,
  loadSessionPhotos,
  saveSessionPhotos,
  clearSession,
  isSessionExpired,
} from "@/lib/analysis-session";
import type { AnalysisSessionState } from "@/lib/analysis-session";
import { useAnalysisSession } from "@/hooks/use-analysis-session";

const mockGetActiveSessionId = vi.mocked(getActiveSessionId);
const mockCreateSessionId = vi.mocked(createSessionId);
const mockLoadSessionState = vi.mocked(loadSessionState);
const mockSaveSessionState = vi.mocked(saveSessionState);
const mockLoadSessionPhotos = vi.mocked(loadSessionPhotos);
const mockSaveSessionPhotos = vi.mocked(saveSessionPhotos);
const mockClearSession = vi.mocked(clearSession);
const mockIsSessionExpired = vi.mocked(isSessionExpired);

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

describe("useAnalysisSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGetActiveSessionId.mockReturnValue(null);
    mockLoadSessionState.mockReturnValue(null);
    mockLoadSessionPhotos.mockResolvedValue([]);
    mockCreateSessionId.mockReturnValue("new-session-id");
    mockClearSession.mockResolvedValue(undefined);
    mockIsSessionExpired.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("restore on mount", () => {
    it("restores state and photos when active session exists", async () => {
      const state = makeState({ description: "Saved meal" });
      const photos = [new Blob(["photo1"])];
      mockGetActiveSessionId.mockReturnValue("existing-session");
      mockLoadSessionState.mockReturnValue(state);
      mockLoadSessionPhotos.mockResolvedValue(photos);

      const { result } = renderHook(() => useAnalysisSession());

      // Wait for async restore
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.state.description).toBe("Saved meal");
      expect(result.current.state.convertedPhotoBlobs).toEqual(photos);
      expect(result.current.state.photos).toEqual([]);
      expect(result.current.wasRestored).toBe(true);
    });

    it("restores state without photos when photos missing from IndexedDB", async () => {
      const state = makeState({ description: "No photos meal" });
      mockGetActiveSessionId.mockReturnValue("existing-session");
      mockLoadSessionState.mockReturnValue(state);
      mockLoadSessionPhotos.mockResolvedValue([]);

      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.state.description).toBe("No photos meal");
      expect(result.current.state.photos).toEqual([]);
      expect(result.current.wasRestored).toBe(true);
    });

    it("returns default empty state when no active session exists", async () => {
      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.state.description).toBe("");
      expect(result.current.state.photos).toEqual([]);
      expect(result.current.state.analysis).toBeNull();
      expect(result.current.wasRestored).toBe(false);
    });

    it("clears and returns default when session is expired", async () => {
      const state = makeState();
      mockGetActiveSessionId.mockReturnValue("expired-session");
      mockLoadSessionState.mockReturnValue(state);
      mockIsSessionExpired.mockReturnValue(true);

      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockClearSession).toHaveBeenCalledWith("expired-session");
      expect(result.current.state.description).toBe("");
      expect(result.current.wasRestored).toBe(false);
    });
  });

  describe("save on change", () => {
    it("debounce-writes state to sessionStorage on change", async () => {
      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Set up a session first
      mockCreateSessionId.mockReturnValue("new-id");

      act(() => {
        result.current.actions.setPhotos([new File(["p"], "p.jpg", { type: "image/jpeg" })]);
      });

      act(() => {
        result.current.actions.setDescription("Updated meal");
      });

      // Not saved yet (debounce)
      expect(mockSaveSessionState).not.toHaveBeenCalled();

      // Advance past debounce
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(mockSaveSessionState).toHaveBeenCalled();
      const savedState = mockSaveSessionState.mock.calls[0][1];
      expect(savedState.description).toBe("Updated meal");
    });

    it("writes photos to IndexedDB immediately on change", async () => {
      mockGetActiveSessionId.mockReturnValue("session-1");
      mockLoadSessionState.mockReturnValue(makeState());

      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const photos = [new File(["new-photo"], "photo.jpg", { type: "image/jpeg" })];
      await act(async () => {
        result.current.actions.setPhotos(photos);
      });

      expect(mockSaveSessionPhotos).toHaveBeenCalledWith("session-1", photos);
    });
  });

  describe("loading state", () => {
    it("returns isRestoring true while IndexedDB read is in progress", async () => {
      mockGetActiveSessionId.mockReturnValue("session-1");
      mockLoadSessionState.mockReturnValue(makeState());
      // Make loadSessionPhotos hang
      let resolvePhotos!: (value: Blob[]) => void;
      mockLoadSessionPhotos.mockReturnValue(
        new Promise((resolve) => {
          resolvePhotos = resolve;
        })
      );

      const { result } = renderHook(() => useAnalysisSession());

      expect(result.current.isRestoring).toBe(true);

      await act(async () => {
        resolvePhotos([]);
      });

      expect(result.current.isRestoring).toBe(false);
    });

    it("returns isRestoring false after restore completes with empty state", async () => {
      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.isRestoring).toBe(false);
    });
  });

  describe("session ID management", () => {
    it("creates new session ID on first photo capture", async () => {
      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(mockCreateSessionId).not.toHaveBeenCalled();

      await act(async () => {
        result.current.actions.setPhotos([new File(["photo"], "photo.jpg", { type: "image/jpeg" })]);
      });

      expect(mockCreateSessionId).toHaveBeenCalledOnce();
    });

    it("reuses existing session ID if one exists", async () => {
      mockGetActiveSessionId.mockReturnValue("existing-session");
      mockLoadSessionState.mockReturnValue(makeState());

      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      await act(async () => {
        result.current.actions.setPhotos([new File(["photo"], "photo.jpg", { type: "image/jpeg" })]);
      });

      expect(mockCreateSessionId).not.toHaveBeenCalled();
      expect(mockSaveSessionPhotos).toHaveBeenCalledWith("existing-session", expect.any(Array));
    });
  });

  describe("clearSession action", () => {
    it("clears all persisted state and resets to defaults", async () => {
      mockGetActiveSessionId.mockReturnValue("session-1");
      mockLoadSessionState.mockReturnValue(makeState({ description: "Saved" }));
      mockLoadSessionPhotos.mockResolvedValue([new File(["photo"], "photo.jpg", { type: "image/jpeg" })]);

      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.state.description).toBe("Saved");
      expect(result.current.wasRestored).toBe(true);

      await act(async () => {
        result.current.actions.clearSession();
      });

      expect(mockClearSession).toHaveBeenCalledWith("session-1");
      expect(result.current.state.description).toBe("");
      expect(result.current.state.photos).toEqual([]);
      expect(result.current.wasRestored).toBe(false);
    });
  });

  describe("createdAt preservation", () => {
    it("preserves original createdAt on debounced saves instead of resetting it", async () => {
      const originalCreatedAt = "2026-03-01T10:00:00.000Z";
      const state = makeState({ createdAt: originalCreatedAt });
      mockGetActiveSessionId.mockReturnValue("session-1");
      mockLoadSessionState.mockReturnValue(state);

      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Change description to trigger a debounced save
      act(() => {
        result.current.actions.setDescription("Updated description");
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(mockSaveSessionState).toHaveBeenCalled();
      const savedState = mockSaveSessionState.mock.calls[0][1];
      expect(savedState.createdAt).toBe(originalCreatedAt);
    });
  });

  describe("getActiveSessionId action", () => {
    it("returns the current session ID", async () => {
      mockGetActiveSessionId.mockReturnValue("session-1");
      mockLoadSessionState.mockReturnValue(makeState());

      const { result } = renderHook(() => useAnalysisSession());

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.actions.getActiveSessionId()).toBe("session-1");
    });
  });
});
