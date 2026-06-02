import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock Sentry
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

// Mock haptics
vi.mock("@/lib/haptics", () => ({
  vibrateError: vi.fn(),
}));

// Mock safe-json
vi.mock("@/lib/safe-json", () => ({
  safeResponseJson: vi.fn(async (response: Response) => response.json()),
}));

import { vibrateError } from "@/lib/haptics";
import { useDeleteFoodEntry } from "@/hooks/use-delete-food-entry";

describe("useDeleteFoodEntry", () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    onSuccess.mockReset();
    vi.mocked(vibrateError).mockClear();
  });

  describe("handleDeleteRequest", () => {
    it("sets deleteTargetId to the given id", () => {
      const { result } = renderHook(() => useDeleteFoodEntry({ onSuccess }));
      expect(result.current.deleteTargetId).toBeNull();

      act(() => {
        result.current.handleDeleteRequest(42);
      });

      expect(result.current.deleteTargetId).toBe(42);
    });
  });

  describe("handleDeleteCancel", () => {
    it("clears deleteTargetId", () => {
      const { result } = renderHook(() => useDeleteFoodEntry({ onSuccess }));

      act(() => {
        result.current.handleDeleteRequest(42);
      });
      expect(result.current.deleteTargetId).toBe(42);

      act(() => {
        result.current.handleDeleteCancel();
      });
      expect(result.current.deleteTargetId).toBeNull();
    });
  });

  describe("handleDeleteConfirm", () => {
    it("does nothing when deleteTargetId is null", async () => {
      const { result } = renderHook(() => useDeleteFoodEntry({ onSuccess }));

      await act(async () => {
        await result.current.handleDeleteConfirm();
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls DELETE /api/food-history/{id} and invokes onSuccess on success", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      });

      const { result } = renderHook(() => useDeleteFoodEntry({ onSuccess }));

      act(() => {
        result.current.handleDeleteRequest(123);
      });

      await act(async () => {
        await result.current.handleDeleteConfirm();
      });

      expect(mockFetch).toHaveBeenCalledWith("/api/food-history/123", expect.objectContaining({
        method: "DELETE",
      }));
      expect(onSuccess).toHaveBeenCalled();
    });

    it("sets deletingId during the request and clears after", async () => {
      let resolveFetch!: (value: unknown) => void;
      mockFetch.mockReturnValue(new Promise((resolve) => {
        resolveFetch = resolve;
      }));

      const { result } = renderHook(() => useDeleteFoodEntry({ onSuccess }));

      act(() => {
        result.current.handleDeleteRequest(99);
      });

      // Start confirm without awaiting — synchronous state updates (setDeletingId)
      // are flushed by act() before the async fetch suspends
      let confirmPromise!: Promise<void>;
      act(() => {
        confirmPromise = result.current.handleDeleteConfirm();
      });

      // Intermediate state: deletingId should be 99 while fetch is pending
      expect(result.current.deletingId).toBe(99);

      // Resolve the fetch and await completion
      await act(async () => {
        resolveFetch({
          ok: true,
          json: async () => ({ success: true }),
          text: async () => JSON.stringify({ success: true }),
        });
        await confirmPromise;
      });

      // After completing, deletingId should be cleared
      expect(result.current.deletingId).toBeNull();
    });

    it("sets deleteError and deleteErrorCode on API error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: { code: "INTERNAL_ERROR", message: "Server error" } }),
        text: async () => JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "Server error" } }),
      });

      const { result } = renderHook(() => useDeleteFoodEntry({ onSuccess }));

      act(() => {
        result.current.handleDeleteRequest(55);
      });

      await act(async () => {
        await result.current.handleDeleteConfirm();
      });

      expect(result.current.deleteError).toBe("Server error");
      expect(result.current.deleteErrorCode).toBe("INTERNAL_ERROR");
      expect(vibrateError).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("handles HEALTH_NOT_CONNECTED with specific message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: { code: "HEALTH_NOT_CONNECTED", message: "Not connected" } }),
        text: async () => JSON.stringify({ success: false, error: { code: "HEALTH_NOT_CONNECTED", message: "Not connected" } }),
      });

      const { result } = renderHook(() => useDeleteFoodEntry({ onSuccess }));
      act(() => { result.current.handleDeleteRequest(1); });

      await act(async () => {
        await result.current.handleDeleteConfirm();
      });

      expect(result.current.deleteError).toBe("Google Health is not connected. Please connect in Settings.");
      expect(result.current.deleteErrorCode).toBe("HEALTH_NOT_CONNECTED");
      expect(vibrateError).toHaveBeenCalled();
    });

    it("handles timeout errors (DOMException TimeoutError)", async () => {
      const timeoutError = new DOMException("Timeout", "TimeoutError");
      mockFetch.mockRejectedValue(timeoutError);

      const { result } = renderHook(() => useDeleteFoodEntry({ onSuccess }));
      act(() => { result.current.handleDeleteRequest(3); });

      await act(async () => {
        await result.current.handleDeleteConfirm();
      });

      expect(result.current.deleteError).toBe("Request timed out. Please try again.");
      expect(vibrateError).toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("handles timeout errors (DOMException AbortError)", async () => {
      const abortError = new DOMException("Abort", "AbortError");
      mockFetch.mockRejectedValue(abortError);

      const { result } = renderHook(() => useDeleteFoodEntry({ onSuccess }));
      act(() => { result.current.handleDeleteRequest(4); });

      await act(async () => {
        await result.current.handleDeleteConfirm();
      });

      expect(result.current.deleteError).toBe("Request timed out. Please try again.");
      expect(vibrateError).toHaveBeenCalled();
    });
  });
});
