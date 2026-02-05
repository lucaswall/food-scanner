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

// Mock fetch (must be before component mocks that might use it)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

  describe("regenerate with edits warning", () => {
    it("regenerate without edits proceeds immediately", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { ...mockAnalysis, food_name: "Updated" } }),
        });

      render(<FoodAnalyzer />);

      // Add photo and analyze
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
      });

      // Click regenerate (no edits made)
      fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));

      // Should proceed immediately (no confirmation dialog)
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    it("regenerate with edits shows warning dialog", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      });

      render(<FoodAnalyzer />);

      // Add photo and analyze
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit manually/i })).toBeInTheDocument();
      });

      // Enter edit mode and make changes
      fireEvent.click(screen.getByRole("button", { name: /edit manually/i }));

      await waitFor(() => {
        expect(screen.getByTestId("nutrition-editor")).toBeInTheDocument();
      });

      // Edit the food name
      const nameInput = screen.getByTestId("nutrition-editor-name");
      fireEvent.change(nameInput, { target: { value: "Modified food" } });

      // Click regenerate
      fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));

      // Should show warning dialog
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /discard your edits/i })).toBeInTheDocument();
      });
    });

    it("confirming regenerate discards edits and re-analyzes", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockAnalysis }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { ...mockAnalysis, food_name: "New Analysis" } }),
        });

      render(<FoodAnalyzer />);

      // Add photo and analyze
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit manually/i })).toBeInTheDocument();
      });

      // Enter edit mode and make changes
      fireEvent.click(screen.getByRole("button", { name: /edit manually/i }));
      await waitFor(() => {
        expect(screen.getByTestId("nutrition-editor")).toBeInTheDocument();
      });

      const nameInput = screen.getByTestId("nutrition-editor-name");
      fireEvent.change(nameInput, { target: { value: "Modified food" } });

      // Click regenerate
      fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));

      // Confirm the regenerate
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /discard your edits/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

      // Should have called analyze API again
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    it("canceling regenerate keeps edits", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      });

      render(<FoodAnalyzer />);

      // Add photo and analyze
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit manually/i })).toBeInTheDocument();
      });

      // Enter edit mode and make changes
      fireEvent.click(screen.getByRole("button", { name: /edit manually/i }));
      await waitFor(() => {
        expect(screen.getByTestId("nutrition-editor")).toBeInTheDocument();
      });

      const nameInput = screen.getByTestId("nutrition-editor-name");
      fireEvent.change(nameInput, { target: { value: "Modified food" } });

      // Click regenerate
      fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));

      // Cancel the regenerate
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /discard your edits/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      // Edits should still be there
      await waitFor(() => {
        expect(screen.getByTestId("nutrition-editor-name")).toHaveValue("Modified food");
      });

      // Should NOT have called analyze API again
      expect(mockFetch).toHaveBeenCalledTimes(1);
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

    it("Escape exits edit mode", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      });

      render(<FoodAnalyzer />);

      // Add photo and analyze
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit manually/i })).toBeInTheDocument();
      });

      // Enter edit mode
      fireEvent.click(screen.getByRole("button", { name: /edit manually/i }));

      await waitFor(() => {
        expect(screen.getByTestId("nutrition-editor")).toBeInTheDocument();
      });

      // Press Escape
      dispatchKeyboardEvent("Escape");

      // Should exit edit mode - button text changes back
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /edit manually/i })).toBeInTheDocument();
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

    it("'Edit Manually' uses ghost variant", async () => {
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

      const editButton = screen.getByRole("button", { name: /edit manually/i });
      // Check data-variant attribute set by Button component
      expect(editButton).toHaveAttribute("data-variant", "ghost");
    });

    it("'Regenerate' uses ghost variant", async () => {
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

      const regenerateButton = screen.getByRole("button", { name: /regenerate/i });
      // Check data-variant attribute set by Button component
      expect(regenerateButton).toHaveAttribute("data-variant", "ghost");
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
