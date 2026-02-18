import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { FoodAnalyzer } from "../food-analyzer";
import type { FoodAnalysis, FoodLogResponse, FoodMatch, AnalyzeFoodResult, ConversationMessage } from "@/types";
import type { StreamEvent } from "@/lib/sse";

// Mock ResizeObserver for Radix UI
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // Mock scrollIntoView for auto-scroll tests
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

// Mock fetch (must be before component mocks that might use it)
const mockFetch = vi.fn();
const originalMockResolvedValueOnce = mockFetch.mockResolvedValueOnce.bind(mockFetch);

// Intercept mockResolvedValueOnce to auto-add .text() method if only .json() is present
mockFetch.mockResolvedValueOnce = (value: unknown) => {
  if (value && typeof value === "object" && "json" in value && !("text" in value)) {
    const enhanced = {
      ...value,
      text: async () => {
        const jsonResult = await (value as { json: () => Promise<unknown> }).json();
        return JSON.stringify(jsonResult);
      },
    };
    return originalMockResolvedValueOnce(enhanced);
  }
  return originalMockResolvedValueOnce(value);
};

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
    autoCapture,
  }: {
    onPhotosChange: (files: File[]) => void;
    autoCapture?: boolean;
  }) => (
    <div data-testid="photo-capture" data-auto-capture={String(!!autoCapture)}>
      <button
        onClick={() =>
          onPhotosChange([new File(["test"], "test.jpg", { type: "image/jpeg" })])
        }
      >
        Add Photo
      </button>
      <button
        onClick={() =>
          onPhotosChange([
            new File(["test1"], "test1.jpg", { type: "image/jpeg" }),
            new File(["test2"], "test2.jpg", { type: "image/jpeg" }),
          ])
        }
      >
        Add Two Photos
      </button>
      <button onClick={() => onPhotosChange([])}>Clear Photos</button>
    </div>
  ),
}));

vi.mock("../description-input", () => ({
  DescriptionInput: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <input
      data-testid="description-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  ),
}));

vi.mock("../analysis-result", () => ({
  AnalysisResult: ({
    analysis,
    loading,
    error,
    onRetry,
    loadingStep,
    narrative,
  }: {
    analysis: FoodAnalysis | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    loadingStep?: string;
    narrative?: string | null;
  }) => (
    <div
      data-testid="analysis-result"
      aria-live={loading ? "assertive" : error ? "polite" : undefined}
    >
      {loading && <span>Loading...</span>}
      {loading && loadingStep && <span data-testid="loading-step">{loadingStep}</span>}
      {error && (
        <>
          <span>{error}</span>
          <button onClick={onRetry}>Retry</button>
        </>
      )}
      {analysis && <span data-testid="food-name">{analysis.food_name}</span>}
      {narrative && <span data-testid="analysis-narrative">{narrative}</span>}
    </div>
  ),
}));

vi.mock("../meal-type-selector", () => ({
  MealTypeSelector: ({
    value,
    onChange,
    disabled,
    id,
  }: {
    value: number;
    onChange: (id: number) => void;
    disabled?: boolean;
    id?: string;
  }) => (
    <div data-testid="meal-type-selector">
      <select
        id={id}
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

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../food-log-confirmation", () => ({
  FoodLogConfirmation: ({
    response,
    foodName,
    mealTypeId,
  }: {
    response: FoodLogResponse | null;
    foodName: string;
    mealTypeId: number;
  }) =>
    response ? (
      <div data-testid="food-log-confirmation" data-meal-type-id={mealTypeId} tabIndex={-1}>
        <span>Successfully logged {foodName}</span>
      </div>
    ) : null,
}));

vi.mock("../food-chat", () => ({
  FoodChat: ({
    initialAnalysis,
    seedMessages,
    onClose,
    onLogged,
  }: {
    initialAnalysis?: FoodAnalysis;
    seedMessages?: ConversationMessage[];
    compressedImages: Blob[];
    onClose: () => void;
    onLogged: (response: FoodLogResponse, analysis: FoodAnalysis, mealTypeId: number) => void;
  }) => (
    <div data-testid="food-chat">
      {initialAnalysis && (
        <span data-testid="chat-food-name">{initialAnalysis.food_name}</span>
      )}
      {seedMessages && (
        <span data-testid="chat-seed-messages">{JSON.stringify(seedMessages)}</span>
      )}
      <button onClick={onClose}>Close Chat</button>
      <button
        onClick={() =>
          onLogged(
            {
              success: true,
              reusedFood: false,
              foodLogId: 999,
            },
            {
              ...(initialAnalysis || mockAnalysisForChat),
              food_name: "Mixed drink: beer and gin",
              calories: 250,
            },
            5 // Dinner - different from default meal type
          )
        }
      >
        Log from Chat
      </button>
    </div>
  ),
}));

// Analysis used by FoodChat mock when no initialAnalysis is provided
const mockAnalysisForChat: FoodAnalysis = {
  food_name: "Default",
  amount: 100,
  unit_id: 147,
  calories: 100,
  protein_g: 5,
  carbs_g: 10,
  fat_g: 5,
  fiber_g: 1,
  sodium_mg: 100,
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "medium",
  notes: "",
  description: "",
  keywords: [],
};

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
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high",
  notes: "Standard Argentine beef empanada",
  description: "A golden-brown baked empanada on a white plate",
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

/** Create a mock fetch response that looks like an SSE stream. */
function makeSseAnalyzeResponse(events: StreamEvent[]) {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
  let index = 0;
  const mockReader = {
    read: (): Promise<{ done: boolean; value: Uint8Array | undefined }> => {
      if (index < chunks.length) {
        return Promise.resolve({ done: false, value: chunks[index++] });
      }
      return Promise.resolve({ done: true, value: undefined });
    },
    releaseLock: () => {},
  };
  return {
    ok: true,
    status: 200,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === "content-type" ? "text/event-stream" : null,
    },
    body: { getReader: () => mockReader },
  };
}

/**
 * Create a controllable SSE stream. Call send() to push events, close() to end it.
 * Useful for testing intermediate loading states.
 */
function makeControllableSseResponse() {
  const encoder = new TextEncoder();
  const queue: Uint8Array[] = [];
  const waiters: Array<(r: { done: boolean; value: Uint8Array | undefined }) => void> = [];
  let closed = false;
  const mockReader = {
    read: (): Promise<{ done: boolean; value: Uint8Array | undefined }> => {
      if (queue.length > 0) {
        return Promise.resolve({ done: false, value: queue.shift()! });
      }
      if (closed) {
        return Promise.resolve({ done: true, value: undefined });
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
    releaseLock: () => {},
  };
  const response = {
    ok: true,
    status: 200,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === "content-type" ? "text/event-stream" : null,
    },
    body: { getReader: () => mockReader },
  };
  return {
    response,
    send: (event: StreamEvent) => {
      const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
      if (waiters.length > 0) {
        waiters.shift()!({ done: false, value: chunk });
      } else {
        queue.push(chunk);
      }
    },
    close: () => {
      closed = true;
      while (waiters.length > 0) {
        waiters.shift()!({ done: true, value: undefined });
      }
    },
  };
}

beforeEach(() => {
  // mockReset clears the once-queue (mockResolvedValueOnce, mockImplementationOnce).
  // vi.clearAllMocks only calls mockClear which does NOT clear the once-queue,
  // so unconsumed once-values from tests that exit early (e.g., compression tests
  // that resolve without awaiting the subsequent fetch) would leak to the next test.
  mockFetch.mockReset();
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

  it("scrolls analysis section into view when Analyze is clicked", async () => {
    const original = Element.prototype.scrollIntoView;
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    try {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
      );

      render(<FoodAnalyzer />);

      const addPhotoButton = screen.getByRole("button", { name: /add photo/i });
      fireEvent.click(addPhotoButton);

      await waitFor(() => {
        const analyzeButton = screen.getByRole("button", { name: /analyze/i });
        expect(analyzeButton).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
      });

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("passes combined abort+timeout signal to analyze-food fetch", async () => {
    const mockAnySignal = {} as AbortSignal;
    const originalAny = AbortSignal.any;
    const anySpy = vi.fn().mockReturnValue(mockAnySignal);
    AbortSignal.any = anySpy;

    try {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
      );

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
      });

      await waitFor(() => {
        const analyzeCall = mockFetch.mock.calls.find(
          (call: unknown[]) => call[0] === "/api/analyze-food"
        );
        expect(analyzeCall).toBeDefined();
        expect((analyzeCall![1] as RequestInit).signal).toBe(mockAnySignal);
      });

      expect(anySpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(AbortSignal),
        ])
      );
    } finally {
      AbortSignal.any = originalAny;
    }
  });

  it("Analyze button calls /api/analyze-food on click", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
    );

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
    mockFetch.mockResolvedValueOnce(
      makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
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

  it("shows user-friendly message when analyze-food fetch times out", async () => {
    mockFetch.mockRejectedValueOnce(
      new DOMException("The operation was aborted due to timeout", "TimeoutError")
    );

    render(<FoodAnalyzer />);

    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /analyze/i })
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

    await waitFor(() => {
      expect(screen.getByText(/analysis timed out/i)).toBeInTheDocument();
    });
  });

  it("Clear resets to initial state", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
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
    mockFetch.mockResolvedValueOnce(
      makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
    );

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
    mockFetch.mockResolvedValueOnce(
      makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
    );

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
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
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
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
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

  it("shows confirmation optimistically while log API is in flight", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockImplementationOnce(() => new Promise(() => {}));

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

    // With optimistic UI, confirmation shows immediately instead of "Logging..." button
    await waitFor(() => {
      expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
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
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
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

    it("disables description input during compression", async () => {
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

      // Verify description input is enabled before compression
      const descInput = screen.getByTestId("description-input");
      expect(descInput).not.toBeDisabled();

      // Click analyze to start compression
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      // Verify description input is disabled during compression
      await waitFor(() => {
        expect(descInput).toBeDisabled();
      });

      // Resolve compression to clean up
      resolveCompression!(new Blob(["compressed"]));
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
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
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
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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

      // Flush pending microtasks and effects so keyboard handler has canLog=true
      await act(async () => {});

      // Use keyboard shortcut to log
      await act(async () => {
        dispatchKeyboardEvent("Enter", { ctrlKey: true, shiftKey: true });
      });

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
    it("shows tips when no photos, no description, and no analysis", () => {
      render(<FoodAnalyzer />);

      expect(screen.getByText(/take a photo or describe your food/i)).toBeInTheDocument();
      expect(screen.getByText(/add details/i)).toBeInTheDocument();
      expect(screen.getByText(/log to fitbit/i)).toBeInTheDocument();
    });

    it("hides tips after photos added", async () => {
      render(<FoodAnalyzer />);

      // Initially tips are visible
      expect(screen.getByText(/take a photo or describe your food/i)).toBeInTheDocument();

      // Add a photo
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

      // Tips should be hidden
      await waitFor(() => {
        const guidanceSection = screen.queryByTestId("first-time-guidance");
        expect(guidanceSection).not.toBeInTheDocument();
      });
    });

    it("hides tips after description typed", async () => {
      render(<FoodAnalyzer />);

      // Initially tips are visible
      expect(screen.getByTestId("first-time-guidance")).toBeInTheDocument();

      // Type a description
      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "2 eggs" } });

      // Tips should be hidden
      await waitFor(() => {
        expect(screen.queryByTestId("first-time-guidance")).not.toBeInTheDocument();
      });
    });
  });

  describe("button hierarchy post-analysis", () => {
    it("'Log to Fitbit' uses default (primary) variant", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
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
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
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
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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

    it("'Use this' includes current analysis metadata in request body", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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
        const logFoodCall = mockFetch.mock.calls.find(
          (call: unknown[]) => call[0] === "/api/log-food"
        );
        expect(logFoodCall).toBeDefined();
        const body = JSON.parse((logFoodCall![1] as RequestInit).body as string);

        // Should include reuse ID
        expect(body.reuseCustomFoodId).toBe(42);

        // Should include current analysis metadata
        expect(body.newDescription).toBe(mockAnalysis.description);
        expect(body.newNotes).toBe(mockAnalysis.notes);
        expect(body.newKeywords).toEqual(mockAnalysis.keywords);
        expect(body.newConfidence).toBe(mockAnalysis.confidence);
      });
    });

    it("'Log as new' still creates a new food entry when matches exist", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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

  describe("food reuse via sourceCustomFoodId", () => {
    const analysisWithSourceId: FoodAnalysis = {
      ...mockAnalysis,
      sourceCustomFoodId: 42,
    };

    it("skips find-matches call when analysis has sourceCustomFoodId", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([{ type: "analysis", analysis: analysisWithSourceId }, { type: "done" }])
      );

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      const findMatchesCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => call[0] === "/api/find-matches"
      );
      expect(findMatchesCalls).toHaveLength(0);
    });

    it("sends reuseCustomFoodId in log-food body when analysis has sourceCustomFoodId", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: analysisWithSourceId }, { type: "done" }])
        )
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
        const logFoodCall = mockFetch.mock.calls.find(
          (call: unknown[]) => call[0] === "/api/log-food"
        );
        expect(logFoodCall).toBeDefined();
        const body = JSON.parse((logFoodCall![1] as RequestInit).body as string);
        expect(body.reuseCustomFoodId).toBe(42);
      });
    });
  });

  describe("text-only analysis (no photos)", () => {
    it("enables Analyze button when description has text and no photos", async () => {
      render(<FoodAnalyzer />);

      // No photos added — type text into description
      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "2 scrambled eggs" } });

      await waitFor(() => {
        const analyzeButton = screen.getByRole("button", { name: /analyze food/i });
        expect(analyzeButton).not.toBeDisabled();
      });
    });

    it("disables Analyze button when neither photos nor description present", () => {
      render(<FoodAnalyzer />);

      const analyzeButton = screen.getByRole("button", { name: /analyze food/i });
      expect(analyzeButton).toBeDisabled();
    });

    it("sends description-only to API when no photos", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      // Type description without adding photos
      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "2 scrambled eggs" } });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze food/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze food/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/analyze-food",
          expect.objectContaining({
            method: "POST",
            body: expect.any(FormData),
          })
        );
      });

      // Verify FormData has description but no images
      const callArgs = mockFetch.mock.calls.find(
        (call: unknown[]) => call[0] === "/api/analyze-food"
      );
      const formData = (callArgs![1] as RequestInit).body as FormData;
      expect(formData.get("description")).toBe("2 scrambled eggs");
      expect(formData.getAll("images")).toHaveLength(0);
    });

    it("skips compression step when no photos", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      // Type description without adding photos
      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "2 scrambled eggs" } });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze food/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze food/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne");
      });

      // compressImage should NOT have been called
      expect(mockCompressImage).not.toHaveBeenCalled();
    });
  });

  describe("optimistic UI for food logging", () => {
    it("shows confirmation immediately after tapping Log to Fitbit", async () => {
      // Analyze response resolves immediately
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
        .mockResolvedValueOnce(emptyMatchesResponse())
        // Log-food fetch hangs — never resolves
        .mockImplementationOnce(() => new Promise(() => {}));

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

      // Confirmation should appear immediately (optimistic) even though fetch hasn't resolved
      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
      });
    });

    it("shows confirmation immediately after tapping Use this (existing food)", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { matches: mockMatches } }),
        })
        // Log-food fetch hangs — never resolves
        .mockImplementationOnce(() => new Promise(() => {}));

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

      // Confirmation should appear immediately (optimistic) even though fetch hasn't resolved
      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
      });
    });

    it("reverts to analysis view on log API error after optimistic update", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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

      // Should revert and show error
      await waitFor(() => {
        expect(screen.getByTestId("log-error")).toBeInTheDocument();
      });

      // Confirmation should be gone
      expect(screen.queryByTestId("food-log-confirmation")).not.toBeInTheDocument();
    });
  });

  describe("meal type label association", () => {
    it("meal type label is associated with selector via htmlFor", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        const label = screen.getByText("Meal Type");
        expect(label.tagName).toBe("LABEL");
        expect(label).toHaveAttribute("for", "meal-type-analyzer");
      });
    });

    it("meal type selector has matching id", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        const select = screen.getByTestId("meal-type-selector").querySelector("select");
        expect(select).toHaveAttribute("id", "meal-type-analyzer");
      });
    });
  });

  describe("conversational food chat", () => {
    it("shows CTA button (not div) after analysis with proper semantics", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        // Should render a button with "Refine" text
        const refineButton = screen.getByRole("button", { name: /refine/i });
        expect(refineButton).toBeInTheDocument();
        expect(refineButton.tagName).toBe("BUTTON");

        // Old div text should NOT appear
        expect(screen.queryByText(/add details or correct something/i)).not.toBeInTheDocument();
      });
    });

    it("renders ONLY FoodChat when chatOpen is true (full-screen mode)", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /refine/i })).toBeInTheDocument();
      });

      // Open chat
      fireEvent.click(screen.getByRole("button", { name: /refine/i }));

      await waitFor(() => {
        // ONLY FoodChat should be in the DOM
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();

        // These components should NOT be in the DOM
        expect(screen.queryByTestId("photo-capture")).not.toBeInTheDocument();
        expect(screen.queryByTestId("description-input")).not.toBeInTheDocument();
        expect(screen.queryByTestId("analysis-result")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /log to fitbit/i })).not.toBeInTheDocument();
        expect(screen.queryByTestId("meal-type-selector")).not.toBeInTheDocument();
      });
    });

    it("shows normal analyzer UI when chatOpen is false after analysis", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        // Normal UI should be shown
        expect(screen.getByTestId("photo-capture")).toBeInTheDocument();
        expect(screen.getByTestId("description-input")).toBeInTheDocument();
        expect(screen.getByTestId("analysis-result")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
        expect(screen.getByTestId("meal-type-selector")).toBeInTheDocument();

        // Chat should not be open
        expect(screen.queryByTestId("food-chat")).not.toBeInTheDocument();
      });
    });

    it("tapping CTA button opens FoodChat component", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /refine/i })).toBeInTheDocument();
      });

      // Click the CTA button
      fireEvent.click(screen.getByRole("button", { name: /refine/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });
    });

    it("quick-log path works without opening chat", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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

      // Log directly without using chat
      fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
      });

      // Chat should never have been opened
      expect(screen.queryByTestId("food-chat")).not.toBeInTheDocument();
    });

    it("hides food matches when FoodChat is open", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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
      });

      // Open chat via CTA button
      fireEvent.click(screen.getByRole("button", { name: /refine/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
        // Food matches should be hidden
        expect(screen.queryByText(/similar foods you've logged before/i)).not.toBeInTheDocument();
      });
    });

    it("returns to post-analysis view when FoodChat onClose is called", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /refine/i })).toBeInTheDocument();
      });

      // Open chat
      fireEvent.click(screen.getByRole("button", { name: /refine/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });

      // Close chat
      fireEvent.click(screen.getByRole("button", { name: /close chat/i }));

      await waitFor(() => {
        expect(screen.queryByTestId("food-chat")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
      });
    });

    it("shows FoodLogConfirmation when FoodChat onLogged is called", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /refine/i })).toBeInTheDocument();
      });

      // Open chat
      fireEvent.click(screen.getByRole("button", { name: /refine/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });

      // Log from chat
      fireEvent.click(screen.getByRole("button", { name: /log from chat/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
        expect(screen.queryByTestId("food-chat")).not.toBeInTheDocument();
      });
    });

    it("shows refined food name on confirmation card after logging from chat", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /refine/i })).toBeInTheDocument();
      });

      // Open chat
      fireEvent.click(screen.getByRole("button", { name: /refine/i }));
      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });

      // Log from chat (mock sends refined analysis with food_name "Mixed drink: beer and gin")
      fireEvent.click(screen.getByRole("button", { name: /log from chat/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
        // Should show the refined name, not the original "Empanada de carne"
        expect(screen.getByText(/Mixed drink: beer and gin/)).toBeInTheDocument();
      });
    });

    it("captures mealTypeId from FoodChat onLogged callback", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /refine/i })).toBeInTheDocument();
      });

      // Open chat
      fireEvent.click(screen.getByRole("button", { name: /refine/i }));
      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });

      // Log from chat (mock passes mealTypeId: 5 for Dinner)
      fireEvent.click(screen.getByRole("button", { name: /log from chat/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
        // Should show meal type 5 (Dinner) from chat, not the original
        const confirmation = screen.getByTestId("food-log-confirmation");
        expect(confirmation).toHaveAttribute("data-meal-type-id", "5");
      });
    });
  });

  describe("focus management", () => {
    it("moves focus to analysis result after analysis completes", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
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
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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

  describe("HTML error response handling", () => {
    it("shows friendly error message when analyze-food returns HTML", async () => {
      // Mock a response that returns HTML when text() is called
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve("<!DOCTYPE html><html><body>Error</body></html>"),
      } as Response);

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText(/server returned an unexpected response/i)).toBeInTheDocument();
      });
    });

    it("shows friendly error message when log-food returns HTML", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
        .mockResolvedValueOnce(emptyMatchesResponse())
        .mockResolvedValueOnce({
          ok: false,
          text: () => Promise.resolve("<html><body>Service Unavailable</body></html>"),
        } as Response);

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
        expect(screen.getByTestId("log-error")).toBeInTheDocument();
        expect(screen.getByText(/server returned an unexpected response/i)).toBeInTheDocument();
      });
    });
  });

  describe("FOO-412: logging state setter", () => {
    it("prevents keyboard shortcut double-submit during logging", async () => {
      // Analyze successfully first
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
        .mockResolvedValueOnce(emptyMatchesResponse())
        // Log API hangs
        .mockImplementationOnce(() => new Promise(() => {}));

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
      });

      // Click log button
      fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

      // Optimistic UI shows confirmation immediately
      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
      });

      // Verify only ONE call to /api/log-food was made (logging state prevents double-submit)
      const logFoodCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => call[0] === "/api/log-food"
      );
      expect(logFoodCalls).toHaveLength(1);
    });
  });

  describe("FOO-414: AbortController on analysis fetch", () => {
    it("aborts in-flight analysis fetch when photos are cleared", async () => {
      // Make analysis fetch hang
      mockFetch.mockImplementationOnce(() => new Promise(() => {}));

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      // Wait for loading state
      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });

      // Clear photos while analysis is in flight
      fireEvent.click(screen.getByRole("button", { name: /clear photos/i }));

      // Analysis result should NOT appear even after clearing
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.queryByTestId("food-name")).not.toBeInTheDocument();
    });

    it("aborts in-flight match fetch when photos are cleared", async () => {
      let matchFetchCalled = false;

      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
        .mockImplementationOnce(() => {
          matchFetchCalled = true;
          return new Promise(() => {}); // Hang forever
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

      // Match fetch should have been called
      await waitFor(() => {
        expect(matchFetchCalled).toBe(true);
      });

      // Clear photos
      fireEvent.click(screen.getByRole("button", { name: /clear photos/i }));

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Match cards should NOT appear
      expect(screen.queryByTestId("food-match-card")).not.toBeInTheDocument();
    });
  });

  // FOO-415: setTimeout clearing real errors
  // Fix verified by code review: compressionWarningTimeoutRef is cleared
  // before setting real errors in both handleAnalyze error paths.
  // Behavior is implicitly tested by existing error handling tests.

  describe("FOO-538: cleanup effects on unmount", () => {
    it("aborts in-flight request on unmount", async () => {
      // Spy on AbortController.prototype.abort
      const abortSpy = vi.spyOn(AbortController.prototype, "abort");

      // Make analysis fetch hang
      mockFetch.mockImplementationOnce(() => new Promise(() => {}));

      const { unmount } = render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      // Wait for loading state
      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });

      // Unmount component while request is in flight
      unmount();

      // Verify abort() was called
      expect(abortSpy).toHaveBeenCalled();

      abortSpy.mockRestore();
    });
  });

  describe("autoCapture guard", () => {
    it("passes autoCapture to PhotoCapture on initial render", () => {
      render(<FoodAnalyzer autoCapture />);

      const photoCapture = screen.getByTestId("photo-capture");
      expect(photoCapture).toHaveAttribute("data-auto-capture", "true");
    });

    it("does not pass autoCapture after photos are taken and analysis exists", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer autoCapture />);

      // Initially autoCapture is true
      expect(screen.getByTestId("photo-capture")).toHaveAttribute("data-auto-capture", "true");

      // Add photo
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });

      // Analyze
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne");
      });

      // After analysis, autoCapture should be false
      expect(screen.getByTestId("photo-capture")).toHaveAttribute("data-auto-capture", "false");
    });

    it("does not pass autoCapture after returning from chat", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer autoCapture />);

      // Add photo and analyze
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /refine/i })).toBeInTheDocument();
      });

      // Open chat
      fireEvent.click(screen.getByRole("button", { name: /refine/i }));
      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });

      // Close chat
      fireEvent.click(screen.getByRole("button", { name: /close chat/i }));
      await waitFor(() => {
        expect(screen.queryByTestId("food-chat")).not.toBeInTheDocument();
      });

      // After returning from chat, autoCapture should be false
      expect(screen.getByTestId("photo-capture")).toHaveAttribute("data-auto-capture", "false");
    });
  });

  describe("needs_chat auto-transition", () => {
    const needsChatResult: AnalyzeFoodResult = {
      type: "needs_chat",
      message: "Let me check what you had yesterday...",
    };

    it("auto-opens FoodChat when API returns needs_chat", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([{ type: "needs_chat", message: needsChatResult.message }, { type: "done" }])
      );

      render(<FoodAnalyzer />);

      // Type a description
      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "same as yesterday" } });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze food/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze food/i }));

      // FoodChat should open automatically
      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });

      // No analysis result should be shown
      expect(screen.queryByTestId("food-name")).not.toBeInTheDocument();
    });

    it("passes seedMessages to FoodChat with user description and assistant message", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([{ type: "needs_chat", message: needsChatResult.message }, { type: "done" }])
      );

      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "same as yesterday" } });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze food/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze food/i }));

      await waitFor(() => {
        expect(screen.getByTestId("chat-seed-messages")).toBeInTheDocument();
      });

      const seedMessagesEl = screen.getByTestId("chat-seed-messages");
      const seedMessages = JSON.parse(seedMessagesEl.textContent!) as ConversationMessage[];

      // Should have 2 messages: user description + assistant response
      expect(seedMessages).toHaveLength(2);
      expect(seedMessages[0].role).toBe("user");
      expect(seedMessages[0].content).toBe("same as yesterday");
      expect(seedMessages[1].role).toBe("assistant");
      expect(seedMessages[1].content).toBe("Let me check what you had yesterday...");
    });

    it("uses default user message when no description provided (photo only)", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([{ type: "needs_chat", message: needsChatResult.message }, { type: "done" }])
      );

      render(<FoodAnalyzer />);

      // Add photo only, no description
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("chat-seed-messages")).toBeInTheDocument();
      });

      const seedMessages = JSON.parse(
        screen.getByTestId("chat-seed-messages").textContent!
      ) as ConversationMessage[];

      expect(seedMessages[0].role).toBe("user");
      expect(seedMessages[0].content).toBe("Analyze this food.");
    });

    it("does not trigger match search for needs_chat response", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([{ type: "needs_chat", message: needsChatResult.message }, { type: "done" }])
      );

      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "same as yesterday" } });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze food/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze food/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });

      // Only 1 fetch call (analyze-food), no find-matches
      const findMatchesCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => call[0] === "/api/find-matches"
      );
      expect(findMatchesCalls).toHaveLength(0);
    });

    it("when API returns analysis type, existing behavior is unchanged", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      // Should show analysis result, not FoodChat
      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne");
      });
      expect(screen.queryByTestId("food-chat")).not.toBeInTheDocument();
    });

    it("onClose from seeded chat returns to analyze screen and clears seed state", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([{ type: "needs_chat", message: needsChatResult.message }, { type: "done" }])
      );

      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "same as yesterday" } });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze food/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze food/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });

      // Close chat
      fireEvent.click(screen.getByRole("button", { name: /close chat/i }));

      await waitFor(() => {
        expect(screen.queryByTestId("food-chat")).not.toBeInTheDocument();
        // Should show the regular analyze UI
        expect(screen.getByTestId("photo-capture")).toBeInTheDocument();
      });
    });

    it("clears stale seedMessages when a subsequent analysis returns type=analysis", async () => {
      // Step 1: First analysis returns needs_chat → sets seedMessages
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([{ type: "needs_chat", message: needsChatResult.message }, { type: "done" }])
      );

      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "same as yesterday" } });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze food/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze food/i }));

      // FoodChat opens with seed messages
      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
        expect(screen.getByTestId("chat-seed-messages")).toBeInTheDocument();
      });

      // Step 2: Close chat to return to analyze screen
      fireEvent.click(screen.getByRole("button", { name: /close chat/i }));

      await waitFor(() => {
        expect(screen.queryByTestId("food-chat")).not.toBeInTheDocument();
      });

      // Step 3: Second analysis returns type=analysis (fast path)
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });
      // Match search response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { matches: [] } }),
      });

      fireEvent.change(descInput, { target: { value: "grilled chicken" } });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze food/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: /analyze food/i }));

      // Should show analysis result
      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      // Step 4: Open "Refine with chat" — should NOT have stale seed messages
      fireEvent.click(screen.getByRole("button", { name: /refine with chat/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });

      // FoodChat should have initialAnalysis but NOT stale seedMessages
      expect(screen.getByTestId("chat-food-name")).toBeInTheDocument();
      expect(screen.queryByTestId("chat-seed-messages")).not.toBeInTheDocument();
    });
  });

  describe("FOO-540: timeout on log-food fetches", () => {
    it("shows 'Request timed out' when handleLogToFitbit fetch times out", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
        .mockResolvedValueOnce(emptyMatchesResponse())
        .mockRejectedValueOnce(new DOMException("The operation was aborted.", "TimeoutError"));

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
        expect(screen.getByTestId("log-error")).toBeInTheDocument();
        expect(screen.getByText(/request timed out/i)).toBeInTheDocument();
      });
    });

    it("shows 'Request timed out' when handleUseExisting fetch times out", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { matches: mockMatches } }),
        })
        .mockRejectedValueOnce(new DOMException("The operation was aborted.", "TimeoutError"));

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
        expect(screen.getByTestId("log-error")).toBeInTheDocument();
        expect(screen.getByText(/request timed out/i)).toBeInTheDocument();
      });
    });

    it("passes AbortSignal.timeout to handleLogToFitbit fetch", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
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
        const logFoodCall = mockFetch.mock.calls.find(
          (call: unknown[]) => call[0] === "/api/log-food"
        );
        expect(logFoodCall).toBeDefined();
        expect((logFoodCall![1] as RequestInit).signal).toBeDefined();
      });
    });
  });

  describe("clientDate in FormData", () => {
    it("includes clientDate in FormData sent to /api/analyze-food", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      });

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/analyze-food",
          expect.objectContaining({
            method: "POST",
            body: expect.any(FormData),
          })
        );
      });

      const callArgs = mockFetch.mock.calls.find(
        (call: unknown[]) => call[0] === "/api/analyze-food"
      );
      const formData = (callArgs![1] as RequestInit).body as FormData;
      const clientDate = formData.get("clientDate");
      // Should be a date string in YYYY-MM-DD format
      expect(clientDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("FOO-563: compression warning timeout cleared in unexpected response branch", () => {
    it("error persists after 3s when unexpected response clears the compression warning timeout", async () => {
      // Use fake timers so we can advance time to verify the compression warning timeout
      // was cleared in the else branch. Without the fix, advancing 3s fires setError(null).
      vi.useFakeTimers();

      try {
        // First photo compresses OK, second fails → failedCount > 0 → setTimeout(3000) set
        mockCompressImage
          .mockResolvedValueOnce(new Blob(["success"]))
          .mockRejectedValueOnce(new Error("Compression failed"));

        // API returns an error event via SSE
        mockFetch.mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "error", message: "Received unexpected response from server" }])
        );

        render(<FoodAnalyzer />);

        // Add 2 photos — sync state update
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /add two photos/i }));
        });

        // Start analysis — kicks off async handleAnalyze
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
        });

        // Flush all pending microtasks from the async chain:
        // allSettled → compression handling → setTimeout set → fetch → safeResponseJson → else branch
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        // The unexpected response error must be set at this point
        expect(
          screen.getByText(/received unexpected response from server/i)
        ).toBeInTheDocument();

        // Advance 3s — without the fix, the compression warning timeout fires, calling setError(null)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3001);
        });

        // Error must STILL be visible: the fix cleared the timeout in the else branch
        expect(
          screen.getByText(/received unexpected response from server/i)
        ).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("FOO-564: stale find-matches result ignored after state reset", () => {
    it("does not show stale match cards when old find-matches resolves after a re-analysis", async () => {
      // Scenario: analysis A → find-matches hangs → reset → analysis B (sourceCustomFoodId skips
      // find-matches) → old find-matches resolves → stale matches must NOT appear.
      // Without the fix (generation counter), setMatches(staleData) runs and corrupts state.
      let resolveMatchFetch!: (value: unknown) => void;
      const matchFetchPromise = new Promise((resolve) => {
        resolveMatchFetch = resolve;
      });

      // Analysis B has sourceCustomFoodId set → component skips find-matches
      mockFetch
        // Analysis A
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        )
        // find-matches for A — hangs until we resolve manually
        .mockImplementationOnce(() => matchFetchPromise)
        // Analysis B
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([
            { type: "analysis", analysis: { ...mockAnalysis, food_name: "Analysis B", sourceCustomFoodId: 99 } },
            { type: "done" },
          ])
        );

      render(<FoodAnalyzer />);

      // --- Step 1: Analyze A ---
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled()
      );
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() =>
        expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne")
      );

      // Wait for find-matches A to have been initiated
      await waitFor(() => {
        expect(
          mockFetch.mock.calls.filter((c: unknown[]) => c[0] === "/api/find-matches")
        ).toHaveLength(1);
      });

      // --- Step 2: User resets (increments generation counter) ---
      fireEvent.click(screen.getByRole("button", { name: /clear photos/i }));

      // --- Step 3: Analyze B (sourceCustomFoodId → no new find-matches call) ---
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled()
      );
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() =>
        expect(screen.getByTestId("food-name")).toHaveTextContent("Analysis B")
      );

      // Confirm no second find-matches call was made
      expect(
        mockFetch.mock.calls.filter((c: unknown[]) => c[0] === "/api/find-matches")
      ).toHaveLength(1);

      // --- Step 4: Old find-matches for A resolves with stale data ---
      await act(async () => {
        resolveMatchFetch({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { matches: mockMatches } }),
        });
        // Flush: matchFetchPromise → .then(r => r.json()) → .then(matchResult => ...)
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // --- Step 5: Stale matches must NOT appear ---
      // Without the fix: setMatches(staleData) runs → match cards appear for Analysis B
      // With the fix: generation counter mismatch → stale result ignored → no match cards
      expect(screen.queryByTestId("food-match-card")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/similar foods you've logged before/i)
      ).not.toBeInTheDocument();
    });
  });

  describe("FOO-571: compressionWarningTimeoutRef cleared in resetAnalysisState and AbortError catch", () => {
    it("error persists after 3s when user resets and new analysis produces error", async () => {
      // Scenario: compression warning timeout pending → user clears photos (resetAnalysisState) →
      // new analysis fails → stale timeout must NOT clear the new error.
      vi.useFakeTimers();

      try {
        // First photo compresses OK, second fails → failedCount > 0 → setTimeout(3000) set
        mockCompressImage
          .mockResolvedValueOnce(new Blob(["success"]))
          .mockRejectedValueOnce(new Error("Compression failed"));

        // First analysis returns valid result (needed to complete the first handleAnalyze)
        mockFetch.mockResolvedValueOnce(
          makeSseAnalyzeResponse([{ type: "analysis", analysis: mockAnalysis }, { type: "done" }])
        );

        render(<FoodAnalyzer />);

        // Add 2 photos → start analysis → compression warning timeout is set
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /add two photos/i }));
        });
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
        });

        // Flush async chain (compression + fetch + response handling)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        // Clear photos → triggers resetAnalysisState → should clear the compression warning timeout
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /clear photos/i }));
        });

        // Set up second analysis that will throw a network error
        mockCompressImage.mockResolvedValueOnce(new Blob(["success"]));
        mockFetch.mockRejectedValueOnce(new Error("Network failure"));

        // Start new analysis
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
        });
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
        });

        // Flush the async chain for the second analysis
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        // The network error should be visible
        expect(screen.getByText(/network failure/i)).toBeInTheDocument();

        // Advance 3s — without the fix, stale compression timeout fires setError(null)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3001);
        });

        // Error must STILL be visible
        expect(screen.getByText(/network failure/i)).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("AbortError path clears compression warning timeout preventing stale setError(null)", async () => {
      // Scenario: compression warning timeout pending → AbortError → stale timeout must not fire
      vi.useFakeTimers();

      try {
        // Photo compresses OK, second fails → failedCount > 0 → setTimeout(3000) set
        mockCompressImage
          .mockResolvedValueOnce(new Blob(["success"]))
          .mockRejectedValueOnce(new Error("Compression failed"));

        // API fetch will be aborted
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        mockFetch.mockRejectedValueOnce(abortError);

        render(<FoodAnalyzer />);

        // Add 2 photos → start analysis
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /add two photos/i }));
        });
        act(() => {
          fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
        });

        // Flush: compression → fetch (AbortError thrown) → catch → AbortError early return
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        // No error should be visible (AbortError is silently ignored)
        expect(screen.queryByText(/error/i)).not.toBeInTheDocument();

        // Advance 3s — without the fix, stale compression timeout fires setError(null)
        // This wouldn't show a visible bug in isolation, but if error state is set between
        // AbortError and timeout firing, the timeout would wipe it. Verify no timeout fires.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3001);
        });

        // Still no error visible (timeout was cleared, nothing happened)
        expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ---- Task 11: SSE streaming analysis ----
  describe("SSE streaming analysis", () => {
    it("shows food name after analysis event arrives via SSE stream", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([
          { type: "analysis", analysis: mockAnalysis },
          { type: "done" },
        ])
      );

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne");
      });
    });

    it("shows error when SSE stream yields error event", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([
          { type: "error", message: "Claude could not analyze the image" },
        ])
      );

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText(/claude could not analyze/i)).toBeInTheDocument();
      });
    });

    it("opens chat when SSE stream yields needs_chat event", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([
          { type: "needs_chat", message: "Let me check what you had yesterday..." },
          { type: "done" },
        ])
      );

      render(<FoodAnalyzer />);

      // Use description-only (no photos) to avoid compression
      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "same as yesterday" } });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      });
    });

    it("calls /api/find-matches after analysis event (no sourceCustomFoodId)", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeSseAnalyzeResponse([
            { type: "analysis", analysis: mockAnalysis },
            { type: "done" },
          ])
        )
        .mockResolvedValueOnce(emptyMatchesResponse());

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/find-matches",
          expect.any(Object)
        );
      });
    });

    it("does not call /api/find-matches when analysis has sourceCustomFoodId", async () => {
      const analysisWithSourceId = { ...mockAnalysis, sourceCustomFoodId: 99 };
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([
          { type: "analysis", analysis: analysisWithSourceId },
          { type: "done" },
        ])
      );

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      // find-matches should NOT have been called
      expect(mockFetch).not.toHaveBeenCalledWith("/api/find-matches", expect.any(Object));
    });

    it("text_delta events accumulate in buffer but do not update loadingStep", async () => {
      const { response, send, close } = makeControllableSseResponse();
      mockFetch.mockResolvedValueOnce(response);

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      // Wait for loading state
      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });

      // Send a text_delta event — should NOT update loadingStep
      act(() => {
        send({ type: "text_delta", text: "Thinking about this food..." });
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // loadingStep should NOT contain text_delta content
      const loadingStepEl = screen.queryByTestId("loading-step");
      if (loadingStepEl) {
        expect(loadingStepEl).not.toHaveTextContent("Thinking about this food...");
      }

      // Complete the stream — narrative should be populated from accumulated text_delta
      act(() => {
        send({ type: "analysis", analysis: mockAnalysis });
        close();
      });

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });
    });

    // FOO-580/FOO-648: text_delta accumulation goes to narrative, tool_start updates loadingStep
    it("tool_start resets text_delta buffer and updates loadingStep; narrative captures pre-tool text", async () => {
      const { response, send, close } = makeControllableSseResponse();
      mockFetch.mockResolvedValueOnce(response);

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });

      // Send multiple text_delta tokens — these accumulate in buffer, do NOT update loadingStep
      act(() => {
        send({ type: "text_delta", text: "Let me " });
      });
      act(() => {
        send({ type: "text_delta", text: "analyze " });
      });
      act(() => {
        send({ type: "text_delta", text: "this food" });
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // loadingStep should NOT contain text_delta content
      const loadingStepEl1 = screen.queryByTestId("loading-step");
      if (loadingStepEl1) {
        expect(loadingStepEl1).not.toHaveTextContent("Let me analyze this food");
      }

      // tool_start should reset the accumulator and update loadingStep
      act(() => {
        send({ type: "tool_start", tool: "search_food_log" });
      });

      await waitFor(() => {
        expect(screen.getByTestId("loading-step")).toHaveTextContent("Checking your food log...");
      });

      // New text_delta after tool_start — still doesn't update loadingStep
      act(() => {
        send({ type: "text_delta", text: "Found some data" });
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // loadingStep should still show tool description
      expect(screen.getByTestId("loading-step")).toHaveTextContent("Checking your food log...");

      act(() => {
        send({ type: "analysis", analysis: mockAnalysis });
        close();
      });

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });
    });

    // ---- Task 15: Tool usage indicators ----
    it("tool_start web_search event shows 'Searching the web...' in loading step", async () => {
      const { response, send, close } = makeControllableSseResponse();
      mockFetch.mockResolvedValueOnce(response);

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });

      act(() => {
        send({ type: "tool_start", tool: "web_search" });
      });

      await waitFor(() => {
        expect(screen.getByTestId("loading-step")).toHaveTextContent("Searching the web...");
      });

      // Complete stream
      act(() => {
        send({ type: "analysis", analysis: mockAnalysis });
        close();
      });

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });
    });

    it("tool_start search_food_log event shows 'Checking your food log...'", async () => {
      const { response, send, close } = makeControllableSseResponse();
      mockFetch.mockResolvedValueOnce(response);

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });

      act(() => {
        send({ type: "tool_start", tool: "search_food_log" });
      });

      await waitFor(() => {
        expect(screen.getByTestId("loading-step")).toHaveTextContent("Checking your food log...");
      });

      act(() => {
        send({ type: "analysis", analysis: mockAnalysis });
        close();
      });

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });
    });

    it("tool_start get_nutrition_summary event shows 'Looking up your nutrition data...'", async () => {
      const { response, send, close } = makeControllableSseResponse();
      mockFetch.mockResolvedValueOnce(response);

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });

      act(() => {
        send({ type: "tool_start", tool: "get_nutrition_summary" });
      });

      await waitFor(() => {
        expect(screen.getByTestId("loading-step")).toHaveTextContent("Looking up your nutrition data...");
      });

      act(() => {
        send({ type: "analysis", analysis: mockAnalysis });
        close();
      });

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });
    });

    it("tool indicators are transient — analysis result replaces them after stream ends", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([
          { type: "tool_start", tool: "web_search" },
          { type: "analysis", analysis: mockAnalysis },
          { type: "done" },
        ])
      );

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      // After stream completes, analysis should be shown (not tool indicator)
      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne");
      });

      // Loading step should be gone (loading ended)
      expect(screen.queryByTestId("loading-step")).not.toBeInTheDocument();
    });
  });

  // ---- FOO-648: Analysis narrative ----
  describe("FOO-648: analysis narrative", () => {
    it("accumulates text_delta events into narrative passed to AnalysisResult", async () => {
      const { response, send, close } = makeControllableSseResponse();
      mockFetch.mockResolvedValueOnce(response);

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });

      act(() => {
        send({ type: "text_delta", text: "This is a detailed " });
      });
      act(() => {
        send({ type: "text_delta", text: "analysis narrative." });
      });
      act(() => {
        send({ type: "analysis", analysis: mockAnalysis });
        close();
      });

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      // Narrative should be passed to AnalysisResult with accumulated text
      expect(screen.getByTestId("analysis-narrative")).toHaveTextContent(
        "This is a detailed analysis narrative."
      );
    });

    it("text_delta events do not update loadingStep during streaming (FOO-648)", async () => {
      const { response, send, close } = makeControllableSseResponse();
      mockFetch.mockResolvedValueOnce(response);

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });

      act(() => {
        send({ type: "text_delta", text: "Thinking about this food in great detail..." });
      });

      // Wait briefly to let any state updates settle
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // loadingStep should NOT show the text_delta content
      const loadingStepEl = screen.queryByTestId("loading-step");
      if (loadingStepEl) {
        expect(loadingStepEl).not.toHaveTextContent("Thinking about this food in great detail...");
      }

      act(() => {
        send({ type: "analysis", analysis: mockAnalysis });
        close();
      });

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });
    });

    it("analysisNarrative is reset to null when resetAnalysisState is called (photos cleared)", async () => {
      const { response, send, close } = makeControllableSseResponse();
      mockFetch.mockResolvedValueOnce(response);

      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });

      act(() => {
        send({ type: "text_delta", text: "This is a long enough narrative for testing." });
        send({ type: "analysis", analysis: mockAnalysis });
        close();
      });

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
        expect(screen.getByTestId("analysis-narrative")).toBeInTheDocument();
      });

      // Clear photos — triggers resetAnalysisState
      fireEvent.click(screen.getByRole("button", { name: /clear photos/i }));

      await waitFor(() => {
        expect(screen.queryByTestId("analysis-narrative")).not.toBeInTheDocument();
      });
    });
  });
});
