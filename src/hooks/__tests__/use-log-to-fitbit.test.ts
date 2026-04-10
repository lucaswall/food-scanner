import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/safe-json", () => ({
  safeResponseJson: vi.fn(),
}));

vi.mock("@/lib/pending-submission", () => ({
  savePendingSubmission: vi.fn(),
}));

vi.mock("@/lib/haptics", () => ({
  vibrateError: vi.fn(),
}));

vi.mock("@/lib/meal-type", () => ({
  getLocalDateTime: vi.fn(),
  getDefaultMealType: vi.fn(() => 7),
}));

import * as Sentry from "@sentry/nextjs";
import { safeResponseJson } from "@/lib/safe-json";
import { savePendingSubmission } from "@/lib/pending-submission";
import { vibrateError } from "@/lib/haptics";
import { getLocalDateTime } from "@/lib/meal-type";
import { useLogToFitbit } from "@/hooks/use-log-to-fitbit";
import type { FoodAnalysis, FoodLogResponse } from "@/types";

const mockSafeResponseJson = vi.mocked(safeResponseJson);
const mockSavePendingSubmission = vi.mocked(savePendingSubmission);
const mockVibrateError = vi.mocked(vibrateError);
const mockGetLocalDateTime = vi.mocked(getLocalDateTime);

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const MOCK_DATETIME = { date: "2026-04-10", time: "12:00", zoneOffset: "+00:00" };

const mockAnalysis: FoodAnalysis = {
  food_name: "Chicken Salad",
  amount: 1,
  unit_id: 304,
  calories: 350,
  protein_g: 25,
  carbs_g: 15,
  fat_g: 20,
  fiber_g: 3,
  sodium_mg: 500,
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high",
  notes: "Grilled chicken",
  description: "Healthy salad",
  keywords: ["chicken", "salad"],
};

const mockLogResponse: FoodLogResponse = {
  success: true,
  reusedFood: false,
  fitbitLogId: 12345,
};

function makeSuccessResponse() {
  return {
    ok: true,
    body: null,
  } as unknown as Response;
}

function makeErrorResponse() {
  return {
    ok: false,
    body: null,
  } as unknown as Response;
}

describe("useLogToFitbit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockGetLocalDateTime.mockReturnValue(MOCK_DATETIME);

    // Default: replace window.location
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "" },
    });
  });

  describe("logToFitbit", () => {
    it("calls fetch with correct body for a new food and sets logResponse on success", async () => {
      const mockResponse = makeSuccessResponse();
      mockFetch.mockResolvedValueOnce(mockResponse);
      mockSafeResponseJson.mockResolvedValueOnce({
        success: true,
        data: mockLogResponse,
      });

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
      );

      await act(async () => {
        await result.current.logToFitbit();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/log-food",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...mockAnalysis,
            mealTypeId: 3,
            date: "2026-04-10",
            time: "12:00",
            zoneOffset: "+00:00",
          }),
        })
      );
      expect(mockSafeResponseJson).toHaveBeenCalledWith(mockResponse);
      expect(result.current.logResponse).toEqual(mockLogResponse);
      expect(result.current.logging).toBe(false);
      expect(result.current.logError).toBeNull();
    });

    it("uses reuseCustomFoodId body when analysis has sourceCustomFoodId", async () => {
      const analysisWithSource: FoodAnalysis = {
        ...mockAnalysis,
        sourceCustomFoodId: 999,
      };
      const mockResponse = makeSuccessResponse();
      mockFetch.mockResolvedValueOnce(mockResponse);
      mockSafeResponseJson.mockResolvedValueOnce({
        success: true,
        data: mockLogResponse,
      });

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: analysisWithSource, mealTypeId: 3 })
      );

      await act(async () => {
        await result.current.logToFitbit();
      });

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody).toEqual({
        reuseCustomFoodId: 999,
        mealTypeId: 3,
        date: "2026-04-10",
        time: "12:00",
        zoneOffset: "+00:00",
        expectedCalories: 350,
      });
    });

    it("uses selectedTime when provided", async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());
      mockSafeResponseJson.mockResolvedValueOnce({ success: true, data: mockLogResponse });

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3, selectedTime: "08:30" })
      );

      await act(async () => {
        await result.current.logToFitbit();
      });

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.time).toBe("08:30");
    });

    it("uses dateOverride when provided", async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());
      mockSafeResponseJson.mockResolvedValueOnce({ success: true, data: mockLogResponse });

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3, dateOverride: "2026-03-15" })
      );

      await act(async () => {
        await result.current.logToFitbit();
      });

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.date).toBe("2026-03-15");
    });

    it("uses AbortSignal.timeout(15000)", async () => {
      const abortSignalSpy = vi.spyOn(AbortSignal, "timeout");
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());
      mockSafeResponseJson.mockResolvedValueOnce({ success: true, data: mockLogResponse });

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
      );

      await act(async () => {
        await result.current.logToFitbit();
      });

      expect(abortSignalSpy).toHaveBeenCalledWith(15000);
    });

    it("calls onSuccess callback with response on success", async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());
      mockSafeResponseJson.mockResolvedValueOnce({ success: true, data: mockLogResponse });

      const onSuccess = vi.fn();
      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3, onSuccess })
      );

      await act(async () => {
        await result.current.logToFitbit();
      });

      expect(onSuccess).toHaveBeenCalledWith(mockLogResponse);
    });

    it("is a no-op when analysis is null", async () => {
      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: null, mealTypeId: 3 })
      );

      await act(async () => {
        await result.current.logToFitbit();
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("is a no-op when already logging (prevents double submission)", async () => {
      // Set up a fetch that never resolves to keep logging=true
      let resolveFirst: (v: unknown) => void = () => {};
      mockFetch.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
      );

      // Start first log — don't await so it stays pending
      act(() => { result.current.logToFitbit(); });

      // Try to start second log while first is in flight
      await act(async () => {
        await result.current.logToFitbit();
      });

      // Only one fetch call despite two logToFitbit calls
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Resolve first
      resolveFirst({ ok: true, body: null });
    });

    describe("error handling — FITBIT_TOKEN_INVALID", () => {
      it("calls savePendingSubmission and redirects to /api/auth/fitbit", async () => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse());
        mockSafeResponseJson.mockResolvedValueOnce({
          success: false,
          error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" },
        });

        const { result } = renderHook(() =>
          useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
        );

        await act(async () => {
          await result.current.logToFitbit();
        });

        expect(mockSavePendingSubmission).toHaveBeenCalledWith({
          analysis: mockAnalysis,
          mealTypeId: 3,
          foodName: "Chicken Salad",
          date: "2026-04-10",
          time: "12:00",
          zoneOffset: "+00:00",
          sessionId: undefined,
        });
        expect(window.location.href).toBe("/api/auth/fitbit");
        expect(mockVibrateError).not.toHaveBeenCalled();
      });
    });

    describe("error handling — FITBIT_CREDENTIALS_MISSING", () => {
      it("sets logError to setup message and calls vibrateError", async () => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse());
        mockSafeResponseJson.mockResolvedValueOnce({
          success: false,
          error: { code: "FITBIT_CREDENTIALS_MISSING", message: "Missing credentials" },
        });

        const { result } = renderHook(() =>
          useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
        );

        await act(async () => {
          await result.current.logToFitbit();
        });

        expect(result.current.logError).toBe(
          "Fitbit is not set up. Please configure your credentials in Settings."
        );
        expect(mockVibrateError).toHaveBeenCalled();
      });
    });

    describe("error handling — FITBIT_NOT_CONNECTED", () => {
      it("sets same error message as FITBIT_CREDENTIALS_MISSING", async () => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse());
        mockSafeResponseJson.mockResolvedValueOnce({
          success: false,
          error: { code: "FITBIT_NOT_CONNECTED", message: "Not connected" },
        });

        const { result } = renderHook(() =>
          useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
        );

        await act(async () => {
          await result.current.logToFitbit();
        });

        expect(result.current.logError).toBe(
          "Fitbit is not set up. Please configure your credentials in Settings."
        );
        expect(mockVibrateError).toHaveBeenCalled();
      });
    });

    describe("error handling — generic error", () => {
      it("sets logError from response message and calls vibrateError", async () => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse());
        mockSafeResponseJson.mockResolvedValueOnce({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
        });

        const { result } = renderHook(() =>
          useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
        );

        await act(async () => {
          await result.current.logToFitbit();
        });

        expect(result.current.logError).toBe("Something went wrong");
        expect(mockVibrateError).toHaveBeenCalled();
      });
    });

    describe("error handling — timeout", () => {
      it("sets logError to timeout message when AbortSignal.timeout fires", async () => {
        const timeoutError = new DOMException("The operation timed out", "TimeoutError");
        mockFetch.mockRejectedValueOnce(timeoutError);

        const { result } = renderHook(() =>
          useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
        );

        await act(async () => {
          await result.current.logToFitbit();
        });

        expect(result.current.logError).toBe("Request timed out. Please try again.");
        expect(mockVibrateError).toHaveBeenCalled();
      });

      it("also handles AbortError as timeout", async () => {
        const abortError = new DOMException("Aborted", "AbortError");
        mockFetch.mockRejectedValueOnce(abortError);

        const { result } = renderHook(() =>
          useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
        );

        await act(async () => {
          await result.current.logToFitbit();
        });

        expect(result.current.logError).toBe("Request timed out. Please try again.");
        expect(mockVibrateError).toHaveBeenCalled();
      });
    });

    describe("error handling — network error", () => {
      it("sets logError from error message, calls vibrateError, and captures to Sentry", async () => {
        const networkErr = new Error("Network failure");
        mockFetch.mockRejectedValueOnce(networkErr);

        const { result } = renderHook(() =>
          useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
        );

        await act(async () => {
          await result.current.logToFitbit();
        });

        expect(result.current.logError).toBe("Network failure");
        expect(mockVibrateError).toHaveBeenCalled();
        expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(networkErr);
      });
    });
  });

  describe("logToFitbitWithMatch", () => {
    it("sends reuseCustomFoodId body with correct fields", async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());
      mockSafeResponseJson.mockResolvedValueOnce({ success: true, data: mockLogResponse });

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
      );

      await act(async () => {
        await result.current.logToFitbitWithMatch({ customFoodId: 42, foodName: "Existing Food" });
      });

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody).toEqual({
        reuseCustomFoodId: 42,
        mealTypeId: 3,
        date: "2026-04-10",
        time: "12:00",
        zoneOffset: "+00:00",
      });
    });

    it("includes metadata fields when provided", async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());
      mockSafeResponseJson.mockResolvedValueOnce({ success: true, data: mockLogResponse });

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
      );

      const metadata = {
        description: "Healthy salad",
        notes: "Grilled chicken",
        keywords: ["chicken", "salad"],
        confidence: "high" as const,
      };

      await act(async () => {
        await result.current.logToFitbitWithMatch(
          { customFoodId: 42, foodName: "Existing Food" },
          metadata
        );
      });

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.newDescription).toBe("Healthy salad");
      expect(fetchBody.newNotes).toBe("Grilled chicken");
      expect(fetchBody.newKeywords).toEqual(["chicken", "salad"]);
      expect(fetchBody.newConfidence).toBe("high");
    });

    it("calls savePendingSubmission with correct args on FITBIT_TOKEN_INVALID", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse());
      mockSafeResponseJson.mockResolvedValueOnce({
        success: false,
        error: { code: "FITBIT_TOKEN_INVALID", message: "expired" },
      });

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
      );

      await act(async () => {
        await result.current.logToFitbitWithMatch({ customFoodId: 42, foodName: "Existing Food" });
      });

      expect(mockSavePendingSubmission).toHaveBeenCalledWith({
        analysis: null,
        mealTypeId: 3,
        foodName: "Existing Food",
        reuseCustomFoodId: 42,
        date: "2026-04-10",
        time: "12:00",
        zoneOffset: "+00:00",
        sessionId: undefined,
      });
      expect(window.location.href).toBe("/api/auth/fitbit");
    });

    it("sets logResponse on success", async () => {
      mockFetch.mockResolvedValueOnce(makeSuccessResponse());
      mockSafeResponseJson.mockResolvedValueOnce({ success: true, data: mockLogResponse });

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
      );

      await act(async () => {
        await result.current.logToFitbitWithMatch({ customFoodId: 42, foodName: "Existing Food" });
      });

      expect(result.current.logResponse).toEqual(mockLogResponse);
    });
  });

  describe("clearLogError", () => {
    it("clears the logError", async () => {
      mockFetch.mockRejectedValueOnce(new Error("fail"));

      const { result } = renderHook(() =>
        useLogToFitbit({ analysis: mockAnalysis, mealTypeId: 3 })
      );

      await act(async () => {
        await result.current.logToFitbit();
      });
      expect(result.current.logError).toBe("fail");

      act(() => {
        result.current.clearLogError();
      });
      expect(result.current.logError).toBeNull();
    });
  });

  describe("getSessionId", () => {
    it("includes sessionId in pending submission when getSessionId returns a value", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse());
      mockSafeResponseJson.mockResolvedValueOnce({
        success: false,
        error: { code: "FITBIT_TOKEN_INVALID", message: "expired" },
      });

      const { result } = renderHook(() =>
        useLogToFitbit({
          analysis: mockAnalysis,
          mealTypeId: 3,
          getSessionId: () => "session-abc",
        })
      );

      await act(async () => {
        await result.current.logToFitbit();
      });

      expect(mockSavePendingSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session-abc" })
      );
    });
  });
});
