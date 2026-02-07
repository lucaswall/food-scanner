import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FoodAnalyzer } from "../food-analyzer";
import type { FoodAnalysis, FoodLogResponse } from "@/types";

// Mock ResizeObserver for Radix UI
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock pending-submission module
const mockSavePending = vi.fn();
const mockGetPending = vi.fn();
const mockClearPending = vi.fn();

vi.mock("@/lib/pending-submission", () => ({
  savePendingSubmission: (...args: unknown[]) => mockSavePending(...args),
  getPendingSubmission: () => mockGetPending(),
  clearPendingSubmission: () => mockClearPending(),
}));

// Mock child components
vi.mock("../photo-capture", () => ({
  PhotoCapture: ({
    onPhotosChange,
  }: {
    onPhotosChange: (files: File[]) => void;
  }) => (
    <div data-testid="photo-capture">
      <button
        onClick={() =>
          onPhotosChange([new File(["test"], "test.jpg", { type: "image/jpeg" })])
        }
      >
        Add Photo
      </button>
    </div>
  ),
}));

vi.mock("../description-input", () => ({
  DescriptionInput: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      data-testid="description-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("../analysis-result", () => ({
  AnalysisResult: ({
    analysis,
    loading,
    error,
    onRetry,
  }: {
    analysis: FoodAnalysis | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
  }) => (
    <div data-testid="analysis-result">
      {loading && <span>Loading...</span>}
      {error && (
        <>
          <span>{error}</span>
          <button onClick={onRetry}>Retry</button>
        </>
      )}
      {analysis && <span data-testid="food-name">{analysis.food_name}</span>}
    </div>
  ),
}));

vi.mock("../meal-type-selector", () => ({
  MealTypeSelector: ({
    value,
    onChange,
    disabled,
  }: {
    value: number;
    onChange: (id: number) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="meal-type-selector">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      >
        <option value="1">Breakfast</option>
        <option value="3">Lunch</option>
        <option value="5">Dinner</option>
      </select>
    </div>
  ),
}));

vi.mock("../nutrition-editor", () => ({
  NutritionEditor: () => <div data-testid="nutrition-editor" />,
}));

vi.mock("../food-match-card", () => ({
  FoodMatchCard: () => <div data-testid="food-match-card" />,
}));

vi.mock("../food-log-confirmation", () => ({
  FoodLogConfirmation: ({
    response,
    foodName,
    onReset,
  }: {
    response: FoodLogResponse | null;
    foodName: string;
    onReset: () => void;
  }) =>
    response ? (
      <div data-testid="food-log-confirmation" tabIndex={-1}>
        <span>Successfully logged {foodName}</span>
        <button onClick={onReset}>Log Another</button>
      </div>
    ) : null,
}));

vi.mock("@/lib/image", () => ({
  compressImage: vi.fn().mockResolvedValue(new Blob(["compressed"])),
}));

vi.mock("@/lib/meal-type", () => ({
  getDefaultMealType: () => 3,
  getLocalDateTime: () => ({ date: "2026-02-07", time: "14:30:00" }),
}));

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
  notes: "Standard Argentine beef empanada",
  keywords: ["empanada", "carne", "beef"],
};

const mockLogResponse: FoodLogResponse = {
  success: true,
  fitbitFoodId: 12345,
  fitbitLogId: 67890,
  reusedFood: false,
};

const emptyMatchesResponse = () => ({
  ok: true,
  json: () => Promise.resolve({ success: true, data: { matches: [] } }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPending.mockReturnValue(null);
  // Prevent actual navigation
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "", assign: vi.fn(), replace: vi.fn() },
  });
});

describe("FoodAnalyzer reconnect flow", () => {
  describe("FITBIT_TOKEN_INVALID during log", () => {
    it("saves pending submission when FITBIT_TOKEN_INVALID is received", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce(emptyMatchesResponse())
        .mockResolvedValueOnce({
          ok: false,
          json: () =>
            Promise.resolve({
              success: false,
              error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" },
            }),
        });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

      await waitFor(() => {
        expect(mockSavePending).toHaveBeenCalledWith(
          expect.objectContaining({
            analysis: mockAnalysis,
            foodName: "Empanada de carne",
          })
        );
      });
    });

    it("redirects to /api/auth/fitbit when FITBIT_TOKEN_INVALID is received", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce(emptyMatchesResponse())
        .mockResolvedValueOnce({
          ok: false,
          json: () =>
            Promise.resolve({
              success: false,
              error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" },
            }),
        });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

      await waitFor(() => {
        expect(window.location.href).toBe("/api/auth/fitbit");
      });
    });

    it("non-token errors still show inline error message", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce(emptyMatchesResponse())
        .mockResolvedValueOnce({
          ok: false,
          json: () =>
            Promise.resolve({
              success: false,
              error: { code: "FITBIT_API_ERROR", message: "Rate limited" },
            }),
        });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

      await waitFor(() => {
        expect(screen.getByText(/rate limited/i)).toBeInTheDocument();
      });

      // Should NOT have saved pending or redirected
      expect(mockSavePending).not.toHaveBeenCalled();
    });
  });

  describe("auto-resubmit on mount", () => {
    it("auto-submits pending submission on mount and shows success", async () => {
      mockGetPending.mockReturnValue({
        analysis: mockAnalysis,
        mealTypeId: 3,
        foodName: "Empanada de carne",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
      });

      render(<FoodAnalyzer />);

      // Should show resubmitting state
      await waitFor(() => {
        expect(screen.getByText(/resubmitting/i)).toBeInTheDocument();
      });

      // Should call log-food with pending data
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/log-food",
          expect.objectContaining({
            method: "POST",
          })
        );
      });

      // Should show success confirmation
      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
      });

      // Should clear pending
      expect(mockClearPending).toHaveBeenCalled();
    });

    it("shows error and clears pending when resubmit fails", async () => {
      mockGetPending.mockReturnValue({
        analysis: mockAnalysis,
        mealTypeId: 3,
        foodName: "Empanada de carne",
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "FITBIT_API_ERROR", message: "Fitbit is down" },
          }),
      });

      render(<FoodAnalyzer />);

      // Should show error after failed resubmit
      await waitFor(() => {
        expect(screen.getByText(/fitbit is down/i)).toBeInTheDocument();
      });

      // Should clear pending
      expect(mockClearPending).toHaveBeenCalled();
    });

    it("auto-submits reuse pending submission with reuseCustomFoodId", async () => {
      mockGetPending.mockReturnValue({
        analysis: null,
        mealTypeId: 5,
        foodName: "Empanada de carne",
        reuseCustomFoodId: 42,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: { ...mockLogResponse, reusedFood: true },
          }),
      });

      render(<FoodAnalyzer />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/log-food",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"reuseCustomFoodId":42'),
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
      });

      expect(mockClearPending).toHaveBeenCalled();
    });

    it("resubmit uses saved date/time from pending data", async () => {
      mockGetPending.mockReturnValue({
        analysis: mockAnalysis,
        mealTypeId: 3,
        foodName: "Empanada de carne",
        date: "2026-02-06",
        time: "12:00:00",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
      });

      render(<FoodAnalyzer />);

      await waitFor(() => {
        const logCall = mockFetch.mock.calls.find(
          (call: unknown[]) => call[0] === "/api/log-food"
        );
        expect(logCall).toBeDefined();
        const body = JSON.parse(logCall![1].body);
        expect(body.date).toBe("2026-02-06");
        expect(body.time).toBe("12:00:00");
      });
    });

    it("resubmit falls back to getLocalDateTime when pending has no date/time", async () => {
      mockGetPending.mockReturnValue({
        analysis: mockAnalysis,
        mealTypeId: 3,
        foodName: "Empanada de carne",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
      });

      render(<FoodAnalyzer />);

      await waitFor(() => {
        const logCall = mockFetch.mock.calls.find(
          (call: unknown[]) => call[0] === "/api/log-food"
        );
        expect(logCall).toBeDefined();
        const body = JSON.parse(logCall![1].body);
        expect(body.date).toBe("2026-02-07");
        expect(body.time).toBe("14:30:00");
      });
    });

    it("savePendingSubmission includes date and time from FITBIT_TOKEN_INVALID flow", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce(emptyMatchesResponse())
        .mockResolvedValueOnce({
          ok: false,
          json: () =>
            Promise.resolve({
              success: false,
              error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" },
            }),
        });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

      await waitFor(() => {
        expect(mockSavePending).toHaveBeenCalledWith(
          expect.objectContaining({
            date: "2026-02-07",
            time: "14:30:00",
          })
        );
      });
    });
  });
});
