import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FoodAnalyzer } from "../food-analyzer";
import type { FoodAnalysis, FoodMatch } from "@/types";

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

// Mock pending-submission
vi.mock("@/lib/pending-submission", () => ({
  savePendingSubmission: vi.fn(),
  getPendingSubmission: vi.fn().mockReturnValue(null),
  clearPendingSubmission: vi.fn(),
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
    response: unknown;
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

// Mock image compression
vi.mock("@/lib/image", () => ({
  compressImage: vi.fn().mockResolvedValue(new Blob(["compressed"])),
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
  description: "A golden-brown baked empanada on a white plate",
  keywords: ["empanada", "carne", "beef"],
};

const refinedAnalysis: FoodAnalysis = {
  food_name: "Empanada de carne con queso",
  amount: 160,
  unit_id: 147,
  calories: 380,
  protein_g: 15,
  carbs_g: 30,
  fat_g: 22,
  fiber_g: 2,
  sodium_mg: 500,
  confidence: "high",
  notes: "Argentine beef empanada with cheese",
  description: "A golden-brown empanada with melted cheese visible",
  keywords: ["empanada", "carne", "queso"],
};

const emptyMatchesResponse = () => ({
  ok: true,
  json: () => Promise.resolve({ success: true, data: { matches: [] } }),
});

/** Helper: add photo and analyze to get into post-analysis state */
async function analyzePhoto() {
  fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
  });
  fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
  await waitFor(() => {
    expect(screen.getByTestId("food-name")).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FoodAnalyzer re-prompt flow", () => {
  it("shows correction input with placeholder after analysis", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse());

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const correctionInput = screen.getByPlaceholderText(/correct something/i);
    expect(correctionInput).toBeInTheDocument();
  });

  it("send button is disabled when correction input is empty", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse());

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const sendButton = screen.getByRole("button", { name: /send correction/i });
    expect(sendButton).toBeDisabled();
  });

  it("submitting a correction calls POST /api/refine-food with images, previousAnalysis, and correction", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: refinedAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse());

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const correctionInput = screen.getByPlaceholderText(/correct something/i);
    fireEvent.change(correctionInput, { target: { value: "it also has cheese" } });

    const sendButton = screen.getByRole("button", { name: /send correction/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      const refineCall = mockFetch.mock.calls.find(
        (call: unknown[]) => call[0] === "/api/refine-food"
      );
      expect(refineCall).toBeDefined();
      const body = refineCall![1].body as FormData;
      expect(body.get("correction")).toBe("it also has cheese");
      expect(body.get("previousAnalysis")).toBe(JSON.stringify(mockAnalysis));
      expect(body.getAll("images").length).toBeGreaterThan(0);
    });
  });

  it("shows loading state during re-prompt", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 5000)));

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const correctionInput = screen.getByPlaceholderText(/correct something/i);
    fireEvent.change(correctionInput, { target: { value: "it also has cheese" } });

    const sendButton = screen.getByRole("button", { name: /send correction/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText(/refining analysis/i)).toBeInTheDocument();
    });
  });

  it("updates analysis display after successful re-prompt", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: refinedAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse());

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const correctionInput = screen.getByPlaceholderText(/correct something/i);
    fireEvent.change(correctionInput, { target: { value: "it also has cheese" } });

    fireEvent.click(screen.getByRole("button", { name: /send correction/i }));

    await waitFor(() => {
      expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne con queso");
    });
  });

  it("clears correction input after successful re-prompt", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: refinedAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse());

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const correctionInput = screen.getByPlaceholderText(/correct something/i);
    fireEvent.change(correctionInput, { target: { value: "it also has cheese" } });
    fireEvent.click(screen.getByRole("button", { name: /send correction/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/correct something/i)).toHaveValue("");
    });
  });

  it("supports multiple re-prompts (refined result becomes new previousAnalysis)", async () => {
    const secondRefinedAnalysis: FoodAnalysis = {
      ...refinedAnalysis,
      food_name: "Empanada de carne con queso y aceitunas",
      calories: 400,
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      // First refine
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: refinedAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      // Second refine
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: secondRefinedAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse());

    render(<FoodAnalyzer />);
    await analyzePhoto();

    // First correction
    const correctionInput = screen.getByPlaceholderText(/correct something/i);
    fireEvent.change(correctionInput, { target: { value: "it also has cheese" } });
    fireEvent.click(screen.getByRole("button", { name: /send correction/i }));

    await waitFor(() => {
      expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne con queso");
    });

    // Second correction — previousAnalysis should be the refined result
    fireEvent.change(screen.getByPlaceholderText(/correct something/i), {
      target: { value: "and olives too" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send correction/i }));

    await waitFor(() => {
      const refineCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => call[0] === "/api/refine-food"
      );
      expect(refineCalls).toHaveLength(2);
      // Second call should use the refined analysis as previousAnalysis
      const secondBody = refineCalls[1][1].body as FormData;
      expect(secondBody.get("previousAnalysis")).toBe(JSON.stringify(refinedAnalysis));
    });

    await waitFor(() => {
      expect(screen.getByTestId("food-name")).toHaveTextContent(
        "Empanada de carne con queso y aceitunas"
      );
    });
  });

  it("shows error message on re-prompt failure", async () => {
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
            error: { code: "CLAUDE_API_ERROR", message: "Failed to refine" },
          }),
      });

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const correctionInput = screen.getByPlaceholderText(/correct something/i);
    fireEvent.change(correctionInput, { target: { value: "it also has cheese" } });
    fireEvent.click(screen.getByRole("button", { name: /send correction/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to refine/i)).toBeInTheDocument();
    });
  });

  it("re-sends compressed images with the re-prompt", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: refinedAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse());

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const correctionInput = screen.getByPlaceholderText(/correct something/i);
    fireEvent.change(correctionInput, { target: { value: "it also has cheese" } });
    fireEvent.click(screen.getByRole("button", { name: /send correction/i }));

    await waitFor(() => {
      const refineCall = mockFetch.mock.calls.find(
        (call: unknown[]) => call[0] === "/api/refine-food"
      );
      expect(refineCall).toBeDefined();
      const body = refineCall![1].body as FormData;
      const images = body.getAll("images");
      expect(images).toHaveLength(1);
      expect(images[0]).toBeInstanceOf(Blob);
    });
  });

  it("shows confirmation immediately when logging (optimistic UI)", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      // Make log-food hang to verify optimistic UI shows before response
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 5000)));

    render(<FoodAnalyzer />);
    await analyzePhoto();

    // Click Log to Fitbit
    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    // Confirmation shows immediately (optimistic), correction input is gone
    await waitFor(() => {
      expect(screen.getByText(/successfully logged/i)).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/correct something/i)).not.toBeInTheDocument();
    });
  });

  it("re-fetches food matches after successful re-prompt", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: refinedAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse());

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const correctionInput = screen.getByPlaceholderText(/correct something/i);
    fireEvent.change(correctionInput, { target: { value: "it also has cheese" } });
    fireEvent.click(screen.getByRole("button", { name: /send correction/i }));

    await waitFor(() => {
      const matchCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => call[0] === "/api/find-matches"
      );
      // Should be called twice: once after initial analysis, once after refine
      expect(matchCalls).toHaveLength(2);
    });
  });

  it("shows Re-analyze button that re-analyzes without correction", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ success: true, data: { ...mockAnalysis, food_name: "Fresh analysis" } }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse());

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const reanalyzeButton = screen.getByRole("button", { name: /re-analyze/i });
    expect(reanalyzeButton).toBeInTheDocument();

    fireEvent.click(reanalyzeButton);

    // Should call analyze-food again (not refine-food)
    await waitFor(() => {
      const analyzeCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => call[0] === "/api/analyze-food"
      );
      expect(analyzeCalls).toHaveLength(2);
    });
  });

  it("Enter key submits correction when input is focused and non-empty", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: refinedAnalysis }),
      })
      .mockResolvedValueOnce(emptyMatchesResponse());

    render(<FoodAnalyzer />);
    await analyzePhoto();

    const correctionInput = screen.getByPlaceholderText(/correct something/i);
    fireEvent.change(correctionInput, { target: { value: "it also has cheese" } });
    fireEvent.keyDown(correctionInput, { key: "Enter" });

    await waitFor(() => {
      const refineCall = mockFetch.mock.calls.find(
        (call: unknown[]) => call[0] === "/api/refine-food"
      );
      expect(refineCall).toBeDefined();
    });
  });
});
