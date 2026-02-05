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
  NutritionEditor: ({
    value,
    onChange,
    disabled,
  }: {
    value: FoodAnalysis;
    onChange: (analysis: FoodAnalysis) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="nutrition-editor">
      <input
        data-testid="nutrition-editor-name"
        value={value.food_name}
        onChange={(e) => onChange({ ...value, food_name: e.target.value })}
        disabled={disabled}
      />
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
      <div data-testid="food-log-confirmation">
        <span>Successfully logged {foodName}</span>
        <button onClick={onReset}>Log Another</button>
      </div>
    ) : null,
}));

// Mock image compression
vi.mock("@/lib/image", () => ({
  compressImage: vi.fn().mockResolvedValue(new Blob(["compressed"])),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockAnalysis: FoodAnalysis = {
  food_name: "Empanada de carne",
  portion_size_g: 150,
  calories: 320,
  protein_g: 12,
  carbs_g: 28,
  fat_g: 18,
  fiber_g: 2,
  sodium_mg: 450,
  confidence: "high",
  notes: "Standard Argentine beef empanada",
};

const mockLogResponse: FoodLogResponse = {
  success: true,
  fitbitFoodId: 12345,
  fitbitLogId: 67890,
  reusedFood: false,
};

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

  it("shows Edit Manually toggle after analysis", async () => {
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
      expect(screen.getByRole("button", { name: /edit manually/i })).toBeInTheDocument();
    });
  });

  it("shows NutritionEditor when Edit Manually is clicked", async () => {
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
      expect(screen.getByRole("button", { name: /edit manually/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /edit manually/i }));

    await waitFor(() => {
      expect(screen.getByTestId("nutrition-editor")).toBeInTheDocument();
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

  it("shows Fitbit reconnect prompt on FITBIT_TOKEN_INVALID", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
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
      expect(screen.getByText(/reconnect/i)).toBeInTheDocument();
    });
  });

  it("resets state after Log Another is clicked", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
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

  it("shows Regenerate Analysis button after analysis", async () => {
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
      expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
    });
  });
});
