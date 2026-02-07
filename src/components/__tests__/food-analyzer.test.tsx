import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FoodAnalyzer } from "../food-analyzer";
import type { FoodAnalysis, FoodLogResponse, FoodMatch } from "@/types";

// Mock ResizeObserver for Radix UI
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// Mock fetch (must be before component mocks that might use it)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock pending-submission (returns null by default — no pending data)
vi.mock("@/lib/pending-submission", () => ({
  savePendingSubmission: vi.fn(),
  getPendingSubmission: vi.fn().mockReturnValue(null),
  clearPendingSubmission: vi.fn(),
}));

// Mock the child components
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
      <button onClick={() => onPhotosChange([])}>Clear Photos</button>
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
    <div
      data-testid="analysis-result"
      aria-live={loading ? "assertive" : error ? "polite" : undefined}
    >
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

vi.mock("../food-match-card", () => ({
  FoodMatchCard: ({
    match,
    onSelect,
    disabled,
  }: {
    match: FoodMatch;
    onSelect: (match: FoodMatch) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="food-match-card">
      <span>{match.foodName}</span>
      <button onClick={() => onSelect(match)} disabled={disabled}>
        Use this
      </button>
    </div>
  ),
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

// Mock image compression - must be defined after vi.mock calls
vi.mock("@/lib/image", () => ({
  compressImage: vi.fn().mockResolvedValue(new Blob(["compressed"])),
}));

// Get reference to the mocked compressImage for per-test control
let mockCompressImage: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  const imageModule = await import("@/lib/image");
  mockCompressImage = imageModule.compressImage as ReturnType<typeof vi.fn>;
});

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

const mockMatches: FoodMatch[] = [
  {
    customFoodId: 42,
    foodName: "Empanada de carne",
    calories: 310,
    proteinG: 11,
    carbsG: 27,
    fatG: 17,
    fitbitFoodId: 111,
    matchRatio: 0.9,
    lastLoggedAt: new Date("2026-02-04T12:00:00Z"),
    amount: 150,
    unitId: 147,
  },
];

const emptyMatchesResponse = () => ({
  ok: true,
  json: () => Promise.resolve({ success: true, data: { matches: [] } }),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FoodAnalyzer", () => {
  it("renders PhotoCapture and DescriptionInput", () => {
    render(<FoodAnalyzer />);

    expect(screen.getByTestId("photo-capture")).toBeInTheDocument();
    expect(screen.getByTestId("description-input")).toBeInTheDocument();
  });

  it("Analyze button is disabled when no photos", () => {
    render(<FoodAnalyzer />);

    const analyzeButton = screen.getByRole("button", { name: /analyze/i });
    expect(analyzeButton).toBeDisabled();
  });

  it("Analyze button is enabled when photos are selected", async () => {
    render(<FoodAnalyzer />);

    // Add a photo via the mock component
    const addPhotoButton = screen.getByRole("button", { name: /add photo/i });
    fireEvent.click(addPhotoButton);

    await waitFor(() => {
      const analyzeButton = screen.getByRole("button", { name: /analyze/i });
      expect(analyzeButton).not.toBeDisabled();
    });
  });

  it("Analyze button calls /api/analyze-food on click", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockAnalysis }),
    });

    render(<FoodAnalyzer />);

    // Add photo
    const addPhotoButton = screen.getByRole("button", { name: /add photo/i });
    fireEvent.click(addPhotoButton);

    // Click analyze
    await waitFor(() => {
      const analyzeButton = screen.getByRole("button", { name: /analyze/i });
      expect(analyzeButton).not.toBeDisabled();
    });

    const analyzeButton = screen.getByRole("button", { name: /analyze/i });
    fireEvent.click(analyzeButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/analyze-food",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        })
      );
    });
  });

  it("shows AnalysisResult after successful analysis", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockAnalysis }),
    });

    render(<FoodAnalyzer />);

    // Add photo and analyze
    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /analyze/i })
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

    await waitFor(() => {
      expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne");
    });
  });

  it("shows error on API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          success: false,
          error: { code: "CLAUDE_API_ERROR", message: "Failed to analyze" },
        }),
    });

    render(<FoodAnalyzer />);

    // Add photo and analyze
    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /analyze/i })
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to analyze/i)).toBeInTheDocument();
    });
  });

  it("Clear resets to initial state", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockAnalysis }),
    });

    render(<FoodAnalyzer />);

    // Add photo and analyze
    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /analyze/i })
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

    await waitFor(() => {
      expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne");
    });

    // Clear
    const clearButton = screen.getByRole("button", { name: /clear photos/i });
    fireEvent.click(clearButton);

    // Analyze button should be disabled again
    await waitFor(() => {
      const analyzeButton = screen.getByRole("button", { name: /analyze/i });
      expect(analyzeButton).toBeDisabled();
    });
  });

  it("shows loading state while analyzing", async () => {
    // Make fetch hang to test loading state
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    );

    render(<FoodAnalyzer />);

    // Add photo and analyze
    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /analyze/i })
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

    // Should show loading state
    await waitFor(() => {
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });
  });

  // New tests for logging flow
  it("shows MealTypeSelector after analysis", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockAnalysis }),
    });

    render(<FoodAnalyzer />);

    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

    await waitFor(() => {
      expect(screen.getByTestId("meal-type-selector")).toBeInTheDocument();
    });
  });

  it("shows Log to Fitbit button after analysis", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockAnalysis }),
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
  });

  it("Log to Fitbit button calls /api/log-food", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
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
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/log-food",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });
  });

  it("shows FoodLogConfirmation after successful log", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
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
      expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
    });
  });

  it("Log to Fitbit is disabled while logging", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 1000)));

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
      expect(screen.getByRole("button", { name: /logging/i })).toBeDisabled();
    });
  });

  it("saves pending and redirects on FITBIT_TOKEN_INVALID", async () => {
    // Override window.location for this test
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });

    const { savePendingSubmission } = await import("@/lib/pending-submission");

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
      expect(savePendingSubmission).toHaveBeenCalled();
      expect(window.location.href).toBe("/api/auth/fitbit");
    });

    // Restore
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });

  it("resets state after Log Another is clicked", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
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
      expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /log another/i }));

    await waitFor(() => {
      // Should not show confirmation anymore
      expect(screen.queryByTestId("food-log-confirmation")).not.toBeInTheDocument();
      // Analyze button should be disabled (no photos)
      expect(screen.getByRole("button", { name: /analyze/i })).toBeDisabled();
    });
  });


  describe("image compression loading state", () => {
    it("shows 'Preparing images...' during compression phase", async () => {
      // Make compression hang to observe the state
      let resolveCompression: (value: Blob) => void;
      mockCompressImage.mockImplementationOnce(
        () =>
          new Promise<Blob>((resolve) => {
            resolveCompression = resolve;
          })
      );

      render(<FoodAnalyzer />);

      // Add photo
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });

      // Click analyze
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      // Should show "Preparing images..." during compression
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /preparing images/i })).toBeInTheDocument();
      });

      // Resolve compression to clean up
      resolveCompression!(new Blob(["compressed"]));
    });

    it("shows 'Analyzing...' after compression completes", async () => {
      // Compression resolves immediately, but fetch hangs
      mockCompressImage.mockResolvedValueOnce(new Blob(["compressed"]));
      mockFetch.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(<FoodAnalyzer />);

      // Add photo
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });

      // Click analyze
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      // Should eventually show "Analyzing..." after compression completes
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyzing/i })).toBeInTheDocument();
      });
    });
  });

  describe("keyboard shortcuts", () => {
    function dispatchKeyboardEvent(
      key: string,
      options: { ctrlKey?: boolean; shiftKey?: boolean } = {}
    ) {
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey: options.ctrlKey || false,
        shiftKey: options.shiftKey || false,
        bubbles: true,
      });
      document.dispatchEvent(event);
    }

    it("Ctrl+Enter triggers analyze when photos present", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      });

      render(<FoodAnalyzer />);

      // Add photo
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });

      // Use keyboard shortcut
      dispatchKeyboardEvent("Enter", { ctrlKey: true });

      // Should trigger analysis
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/analyze-food",
          expect.any(Object)
        );
      });
    });

    it("Ctrl+Shift+Enter triggers log when analysis present", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce(emptyMatchesResponse())
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockLogResponse }),
        });

      render(<FoodAnalyzer />);

      // Add photo and analyze
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
      });

      // Use keyboard shortcut to log
      dispatchKeyboardEvent("Enter", { ctrlKey: true, shiftKey: true });

      // Should trigger log
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/log-food",
          expect.any(Object)
        );
      });
    });

  });

  describe("first-time user guidance", () => {
    it("shows tips when no photos and no analysis", () => {
      render(<FoodAnalyzer />);

      expect(screen.getByText(/take a photo/i)).toBeInTheDocument();
      expect(screen.getByText(/add description/i)).toBeInTheDocument();
      expect(screen.getByText(/log to fitbit/i)).toBeInTheDocument();
    });

    it("hides tips after photos added", async () => {
      render(<FoodAnalyzer />);

      // Initially tips are visible
      expect(screen.getByText(/take a photo/i)).toBeInTheDocument();

      // Add a photo
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

      // Tips should be hidden
      await waitFor(() => {
        // The "Take a photo" text in the guidance should be gone
        // (Note: "Log to Fitbit" will still appear as a button after analysis, so we check the guidance specifically)
        const guidanceSection = screen.queryByTestId("first-time-guidance");
        expect(guidanceSection).not.toBeInTheDocument();
      });
    });
  });

  describe("button hierarchy post-analysis", () => {
    it("'Log to Fitbit' uses default (primary) variant", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
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

      const logButton = screen.getByRole("button", { name: /log to fitbit/i });
      // Check data-variant attribute set by Button component
      expect(logButton).toHaveAttribute("data-variant", "default");
    });

  });

  describe("state transition animations", () => {
    it("applies animation class to analysis result container", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("analysis-result")).toBeInTheDocument();
      });

      // Check the container has animation class
      const analysisContainer = screen.getByTestId("analysis-section");
      expect(analysisContainer.className).toMatch(/animate-fade-in/);
    });
  });

  describe("aria-live regions", () => {
    it("has aria-live='polite' on error messages", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "CLAUDE_API_ERROR", message: "Failed to analyze" },
          }),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        const errorContainer = screen.getByTestId("analysis-result");
        expect(errorContainer).toHaveAttribute("aria-live", "polite");
      });
    });

    it("has aria-live='assertive' on loading state", async () => {
      mockFetch.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        const loadingContainer = screen.getByTestId("analysis-result");
        expect(loadingContainer).toHaveAttribute("aria-live", "assertive");
      });
    });

    it("has aria-live='polite' on log error messages", async () => {
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
              error: { code: "FITBIT_API_ERROR", message: "Failed to log" },
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
        const errorContainer = screen.getByTestId("log-error");
        expect(errorContainer).toHaveAttribute("aria-live", "polite");
      });
    });
  });

  describe("food matching", () => {
    it("calls /api/find-matches after analysis succeeds", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { matches: mockMatches } }),
        });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/find-matches",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
          })
        );
      });
    });

    it("shows match section when matches returned", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { matches: mockMatches } }),
        });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText(/similar foods you've logged before/i)).toBeInTheDocument();
        expect(screen.getByTestId("food-match-card")).toBeInTheDocument();
      });
    });

    it("hides match section when no matches", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { matches: [] } }),
        });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      expect(screen.queryByText(/similar foods you've logged before/i)).not.toBeInTheDocument();
      expect(screen.queryByTestId("food-match-card")).not.toBeInTheDocument();
    });

    it("'Use this' triggers the reuse log flow", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { matches: mockMatches } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { ...mockLogResponse, reusedFood: true } }),
        });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-match-card")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /use this/i }));

      await waitFor(() => {
        // Should call log-food with reuseCustomFoodId
        const logFoodCall = mockFetch.mock.calls.find(
          (call: unknown[]) => call[0] === "/api/log-food"
        );
        expect(logFoodCall).toBeDefined();
        const body = JSON.parse((logFoodCall![1] as RequestInit).body as string);
        expect(body.reuseCustomFoodId).toBe(42);
      });
    });

    it("'Log as new' still creates a new food entry when matches exist", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { matches: mockMatches } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockLogResponse }),
        });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /log as new/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /log as new/i }));

      await waitFor(() => {
        const logFoodCall = mockFetch.mock.calls.find(
          (call: unknown[]) => call[0] === "/api/log-food"
        );
        expect(logFoodCall).toBeDefined();
        const body = JSON.parse((logFoodCall![1] as RequestInit).body as string);
        expect(body.reuseCustomFoodId).toBeUndefined();
      });
    });
  });

  describe("focus management", () => {
    it("moves focus to analysis result after analysis completes", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      // Focus should be on analysis section
      await waitFor(() => {
        const analysisSection = screen.getByTestId("analysis-section");
        expect(analysisSection).toHaveFocus();
      });
    });

    it("moves focus to confirmation after log succeeds", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce(emptyMatchesResponse())
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockLogResponse }),
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
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
      });

      // Focus should be on confirmation wrapper (parent of food-log-confirmation)
      await waitFor(() => {
        const confirmationSection = screen.getByTestId("food-log-confirmation").parentElement;
        expect(confirmationSection).toHaveFocus();
      });
    });
  });
});
