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

// Mock useAnalysisSession hook — uses real React state by default so existing tests
// continue to work. Individual tests can override via mockUseAnalysisSession.mockReturnValue().
const mockClearSession = vi.fn();
const mockGetActiveSessionId = vi.fn().mockReturnValue(null);

// Spy wrappers that track calls while still updating real state
const sessionSpies = {
  setPhotos: vi.fn(),
  setCompressedImages: vi.fn(),
  setDescription: vi.fn(),
  setAnalysis: vi.fn(),
  setAnalysisNarrative: vi.fn(),
  setMealTypeId: vi.fn(),
  setSelectedTime: vi.fn(),
  setMatches: vi.fn(),
  clearSession: mockClearSession,
  getActiveSessionId: mockGetActiveSessionId,
};

const { useAnalysisSession: mockUseAnalysisSession } = vi.hoisted(() => {
  return {
    useAnalysisSession: vi.fn(),
  };
});

// The "real" implementation that uses React state (for existing tests)
function useAnalysisSessionReal() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useState: useStateFn } = require("react");
  const [photos, setPhotosRaw] = useStateFn([] as File[]);
  const [convertedPhotoBlobs, setConvertedPhotoBlobsRaw] = useStateFn([] as (File | Blob)[]);
  const [compressedImages, setCompressedImagesRaw] = useStateFn(null as Blob[] | null);
  const [description, setDescriptionRaw] = useStateFn("");
  const [analysis, setAnalysisRaw] = useStateFn(null as FoodAnalysis | null);
  const [analysisNarrative, setAnalysisNarrativeRaw] = useStateFn(null as string | null);
  const [mealTypeId, setMealTypeIdRaw] = useStateFn(3);
  const [selectedTime, setSelectedTimeRaw] = useStateFn(null as string | null);
  const [matches, setMatchesRaw] = useStateFn([] as FoodMatch[]);

  return {
    state: { photos, convertedPhotoBlobs, compressedImages, description, analysis, analysisNarrative, mealTypeId, selectedTime, matches },
    actions: {
      setPhotos: (newPhotos: File[], convertedBlobs?: (File | Blob)[]) => {
        sessionSpies.setPhotos(newPhotos, convertedBlobs);
        setPhotosRaw(newPhotos);
        setConvertedPhotoBlobsRaw(convertedBlobs || []);
      },
      setCompressedImages: (images: Blob[] | null) => { sessionSpies.setCompressedImages(images); setCompressedImagesRaw(images); },
      setDescription: (desc: string) => { sessionSpies.setDescription(desc); setDescriptionRaw(desc); },
      setAnalysis: (a: FoodAnalysis | null) => { sessionSpies.setAnalysis(a); setAnalysisRaw(a); },
      setAnalysisNarrative: (n: string | null) => { sessionSpies.setAnalysisNarrative(n); setAnalysisNarrativeRaw(n); },
      setMealTypeId: (id: number) => { sessionSpies.setMealTypeId(id); setMealTypeIdRaw(id); },
      setSelectedTime: (t: string | null) => { sessionSpies.setSelectedTime(t); setSelectedTimeRaw(t); },
      setMatches: (m: FoodMatch[]) => { sessionSpies.setMatches(m); setMatchesRaw(m); },
      clearSession: mockClearSession,
      getActiveSessionId: mockGetActiveSessionId,
    },
    isRestoring: false,
    wasRestored: false,
  };
}

const mockKeyboardHeight = { current: 0 };
vi.mock("@/hooks/use-keyboard-height", () => ({
  useKeyboardHeight: () => mockKeyboardHeight.current,
}));

vi.mock("@/hooks/use-analysis-session", () => ({
  useAnalysisSession: mockUseAnalysisSession,
}));

// Mock the child components
vi.mock("../photo-capture", () => ({
  PhotoCapture: ({
    onPhotosChange,
    autoCapture,
    restoredBlobs,
  }: {
    onPhotosChange: (files: File[]) => void;
    autoCapture?: boolean;
    restoredBlobs?: Blob[];
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useState: useStateFn } = require("react");
    const [internalPhotos, setInternalPhotos] = useStateFn([] as string[]);

    return (
      <div data-testid="photo-capture" data-auto-capture={String(!!autoCapture)} data-restored-count={restoredBlobs?.length ?? 0}>
        <button
          onClick={() => {
            const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
            setInternalPhotos((prev: string[]) => [...prev, "test.jpg"]);
            onPhotosChange([file]);
          }}
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
        {internalPhotos.map((name: string, i: number) => (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={i} src={`blob:${name}`} alt={`Preview ${i + 1}`} data-testid="photo-preview" />
          </>
        ))}
        {restoredBlobs && restoredBlobs.length > 0 && (
          <span data-testid="restored-photos-indicator">{restoredBlobs.length} restored</span>
        )}
      </div>
    );
  },
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

// Mock TimeSelector
vi.mock("../time-selector", () => ({
  TimeSelector: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (time: string | null) => void;
  }) => (
    <div data-testid="time-selector">
      <button onClick={() => onChange(null)} aria-label="Reset to Now">Now</button>
      <input
        type="time"
        aria-label="Meal time"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      />
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

const { mockCaptureException: mockCaptureExceptionAnalyzer } = vi.hoisted(() => ({
  mockCaptureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mockCaptureExceptionAnalyzer,
}));

vi.mock("../food-log-confirmation", () => ({
  FoodLogConfirmation: ({
    response,
    foodName,
    mealTypeId,
    onDone,
  }: {
    response: FoodLogResponse | null;
    foodName: string;
    mealTypeId: number;
    onDone?: () => void;
  }) =>
    response ? (
      <div data-testid="food-log-confirmation" data-meal-type-id={mealTypeId} tabIndex={-1}>
        <span>Successfully logged {foodName}</span>
        <button onClick={onDone}>Done</button>
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
    cancel: () => Promise.resolve(),
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
    cancel: () => Promise.resolve(),
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

  // Default: use real React state implementation so existing tests work unchanged
  mockUseAnalysisSession.mockImplementation(useAnalysisSessionReal);
});

describe("FoodAnalyzer", () => {
  it("renders PhotoCapture and DescriptionInput", () => {
    render(<FoodAnalyzer />);

    expect(screen.getByTestId("photo-capture")).toBeInTheDocument();
    expect(screen.getByTestId("description-input")).toBeInTheDocument();
  });

  it("Sticky CTA bar is not shown when no content exists", () => {
    render(<FoodAnalyzer />);

    expect(screen.queryByTestId("sticky-cta-bar")).not.toBeInTheDocument();
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

  it("passes AbortController signal to analyze-food fetch (no AbortSignal.any dependency)", async () => {
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
      expect((analyzeCall![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    });
  });

  it("analysis works when AbortSignal.any is not available (older browsers)", async () => {
    const originalAny = AbortSignal.any;
    // Simulate older browser that doesn't have AbortSignal.any
    (AbortSignal as unknown as Record<string, unknown>).any = undefined;

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
        expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne");
      });
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

    // Sticky CTA bar should be hidden after clearing all content
    await waitFor(() => {
      expect(screen.queryByTestId("sticky-cta-bar")).not.toBeInTheDocument();
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

  it("does not show confirmation while log API is in flight (FOO-661)", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
        { type: "analysis", analysis: mockAnalysis },
        { type: "done" },
      ]),
      })
      .mockResolvedValueOnce(emptyMatchesResponse())
      .mockImplementationOnce(() => new Promise(() => {})); // hangs forever

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

    // Wait for logging state to activate (fetch has been called)
    await waitFor(() => {
      expect(mockFetch.mock.calls.some((call: unknown[]) => call[0] === "/api/log-food")).toBe(true);
    });

    // Confirmation should NOT appear while fetch is still pending
    expect(screen.queryByTestId("food-log-confirmation")).not.toBeInTheDocument();
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

  describe("Start over button", () => {
    it("renders h1 heading 'Analyze Food' always", () => {
      render(<FoodAnalyzer />);

      expect(screen.getByRole("heading", { level: 1, name: /analyze food/i })).toBeInTheDocument();
    });

    it("is NOT shown when no content exists, but h1 row height is stable", () => {
      render(<FoodAnalyzer />);

      expect(screen.queryByRole("button", { name: /start over/i })).not.toBeInTheDocument();
      // h1 is always present so the row height doesn't shift
      expect(screen.getByRole("heading", { level: 1, name: /analyze food/i })).toBeInTheDocument();
    });

    it("IS shown when photos exist", async () => {
      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /start over/i })).toBeInTheDocument();
      });
    });

    it("IS shown when description is non-empty", async () => {
      render(<FoodAnalyzer />);

      fireEvent.change(screen.getByTestId("description-input"), {
        target: { value: "2 eggs" },
      });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /start over/i })).toBeInTheDocument();
      });
    });

    it("IS shown when analysis exists", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
          { type: "analysis", analysis: mockAnalysis },
          { type: "done" },
        ]),
      });

      render(<FoodAnalyzer />);
      fireEvent.change(screen.getByTestId("description-input"), {
        target: { value: "empanada" },
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: /start over/i })).toBeInTheDocument();
    });

    it("clicking shows a confirmation dialog with 'Start over?' title", async () => {
      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /start over/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /start over/i }));

      await waitFor(() => {
        expect(screen.getByText("Start over?")).toBeInTheDocument();
        expect(screen.getByText(/clear all photos, description, and analysis/i)).toBeInTheDocument();
      });
    });

    it("confirming the dialog resets all state", async () => {
      render(<FoodAnalyzer />);

      // Add photo and description
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.change(screen.getByTestId("description-input"), {
        target: { value: "some food" },
      });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /start over/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /start over/i }));

      await waitFor(() => {
        expect(screen.getByText("Start over?")).toBeInTheDocument();
      });

      // Click the destructive "Start over" action button in the dialog
      const dialogActions = screen.getAllByRole("button", { name: /start over/i });
      const confirmButton = dialogActions[dialogActions.length - 1];
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockClearSession).toHaveBeenCalled();
      });

      // Start over button should be gone (no content)
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /start over/i })).not.toBeInTheDocument();
      });
    });

    it("canceling the dialog does not clear state", async () => {
      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /start over/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /start over/i }));

      await waitFor(() => {
        expect(screen.getByText("Start over?")).toBeInTheDocument();
      });

      // Click Cancel
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      // State should still be there
      expect(mockClearSession).not.toHaveBeenCalled();
      // Start over button should still be visible (photos still present)
      expect(screen.getByRole("button", { name: /start over/i })).toBeInTheDocument();
    });

    it("confirming Start Over re-mounts PhotoCapture, clearing all thumbnails", async () => {
      render(<FoodAnalyzer />);

      // Add a photo — should render a preview inside the mock PhotoCapture
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

      await waitFor(() => {
        expect(screen.getByTestId("photo-preview")).toBeInTheDocument();
      });

      // Click Start over
      fireEvent.click(screen.getByRole("button", { name: /start over/i }));

      await waitFor(() => {
        expect(screen.getByText("Start over?")).toBeInTheDocument();
      });

      // Confirm the dialog
      const dialogActions = screen.getAllByRole("button", { name: /start over/i });
      const confirmButton = dialogActions[dialogActions.length - 1];
      fireEvent.click(confirmButton);

      // PhotoCapture should have re-mounted: no preview images, but camera input still exists
      await waitFor(() => {
        expect(screen.queryByTestId("photo-preview")).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("photo-capture")).toBeInTheDocument();
    });
  });

  describe("sticky CTA bar", () => {
    it("renders 'Analyze Food' button in sticky bar when content exists", async () => {
      render(<FoodAnalyzer />);

      // Add description to trigger hasContent
      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "some food" } });

      await waitFor(() => {
        const stickyBar = screen.getByTestId("sticky-cta-bar");
        expect(stickyBar).toBeInTheDocument();
        expect(stickyBar).toHaveTextContent(/analyze food/i);
      });
    });

    it("shows 'Log to Fitbit' when analysis exists", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
          { type: "analysis", analysis: mockAnalysis },
          { type: "done" },
        ]),
      });

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      const stickyBar = screen.getByTestId("sticky-cta-bar");
      expect(stickyBar).toHaveTextContent(/log to fitbit/i);
    });

    it("shows 'Log as new' when analysis exists with matches", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ...makeSseAnalyzeResponse([
            { type: "analysis", analysis: mockAnalysis },
            { type: "done" },
          ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: { matches: mockMatches } }),
        });

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      await waitFor(() => {
        const stickyBar = screen.getByTestId("sticky-cta-bar");
        expect(stickyBar).toHaveTextContent(/log as new/i);
      });
    });

    it("positions above keyboard when keyboard is open", async () => {
      mockKeyboardHeight.current = 300;
      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "some food" } });

      await waitFor(() => {
        const stickyBar = screen.getByTestId("sticky-cta-bar");
        expect(stickyBar).toBeInTheDocument();
        expect(stickyBar.style.bottom).toBe("300px");
      });

      mockKeyboardHeight.current = 0;
    });

    it("uses default positioning when keyboard is closed", async () => {
      mockKeyboardHeight.current = 0;
      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "some food" } });

      await waitFor(() => {
        const stickyBar = screen.getByTestId("sticky-cta-bar");
        expect(stickyBar).toBeInTheDocument();
        // No inline bottom style when keyboard is closed
        expect(stickyBar.style.bottom).toBe("");
      });
    });

    it("uses opaque background and bottom border when keyboard is open", async () => {
      mockKeyboardHeight.current = 300;
      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "some food" } });

      await waitFor(() => {
        const stickyBar = screen.getByTestId("sticky-cta-bar");
        const innerContainer = stickyBar.firstElementChild as HTMLElement;
        expect(innerContainer.className).toContain("bg-background");
        expect(innerContainer.className).not.toContain("bg-background/80");
        expect(innerContainer.className).toContain("border-b");
      });

      mockKeyboardHeight.current = 0;
    });

    it("uses translucent background when keyboard is closed", async () => {
      mockKeyboardHeight.current = 0;
      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "some food" } });

      await waitFor(() => {
        const stickyBar = screen.getByTestId("sticky-cta-bar");
        const innerContainer = stickyBar.firstElementChild as HTMLElement;
        expect(innerContainer.className).toContain("bg-background/80");
        expect(innerContainer.className).toContain("backdrop-blur-sm");
        expect(innerContainer.className).not.toContain("border-b");
      });
    });

    it("is not rendered when logResponse exists", async () => {
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
          json: async () => ({ success: true, data: mockLogResponse }),
        });

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

      await waitFor(() => {
        expect(screen.queryByTestId("sticky-cta-bar")).not.toBeInTheDocument();
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

    it("sticky CTA bar is hidden when neither photos nor description present", () => {
      render(<FoodAnalyzer />);

      expect(screen.queryByTestId("sticky-cta-bar")).not.toBeInTheDocument();
    });

    it("Analyze Food button is enabled when description entered", async () => {
      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "2 scrambled eggs" } });

      await waitFor(() => {
        const analyzeButton = screen.getByRole("button", { name: /analyze food/i });
        expect(analyzeButton).not.toBeDisabled();
      });
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

  describe("food logging confirmation behavior", () => {
    it("shows confirmation only after API responds to Log to Fitbit", async () => {
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

      // Confirmation appears only after the API responds
      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
      });
    });

    it("shows confirmation only after API responds to Use this (existing food)", async () => {
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
        expect(screen.getByTestId("food-match-card")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /use this/i }));

      // Confirmation appears only after the API responds
      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
      });
    });

    it("shows error and no confirmation on log API error", async () => {
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

      // Should show error, no confirmation
      await waitFor(() => {
        expect(screen.getByTestId("log-error")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("food-log-confirmation")).not.toBeInTheDocument();
    });
  });

  describe("meal type selector accessibility", () => {
    it("meal type selector renders after analysis", async () => {
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
        expect(screen.getByTestId("meal-type-selector")).toBeInTheDocument();
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

    it("FoodChat is rendered inside a fixed overlay container when chatOpen is true", async () => {
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

      fireEvent.click(screen.getByRole("button", { name: /refine/i }));

      await waitFor(() => {
        const foodChat = screen.getByTestId("food-chat");
        const wrapper = foodChat.parentElement!;
        expect(wrapper.className).toContain("fixed");
        expect(wrapper.className).toContain("inset-0");
        expect(wrapper.className).toContain("z-[60]");
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

      // Wait for the log-food fetch to be called (logging state is active)
      await waitFor(() => {
        expect(mockFetch.mock.calls.some((call: unknown[]) => call[0] === "/api/log-food")).toBe(true);
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

    it("shows error when SSE response has null body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) =>
            h.toLowerCase() === "content-type" ? "text/event-stream" : null,
        },
        body: null,
      });

      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "test food" } });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText(/no response body/i)).toBeInTheDocument();
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

  // FOO-714: TimeSelector integration in food-analyzer
  describe("TimeSelector integration", () => {
    it("TimeSelector appears alongside MealTypeSelector after analysis", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ...makeSseAnalyzeResponse([
            { type: "analysis", analysis: mockAnalysis },
            { type: "done" },
          ]),
        })
        .mockResolvedValueOnce(emptyMatchesResponse());

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("time-selector")).toBeInTheDocument();
      });
    });

    it("TimeSelector is not shown before analysis", () => {
      render(<FoodAnalyzer />);
      expect(screen.queryByTestId("time-selector")).not.toBeInTheDocument();
    });

    it("selected time is passed to /api/log-food", async () => {
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
        expect(screen.getByTestId("time-selector")).toBeInTheDocument();
      });

      const timeInput = screen.getByLabelText(/meal time/i);
      fireEvent.change(timeInput, { target: { value: "08:15" } });

      fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/log-food", expect.any(Object));
      });

      const logCall = mockFetch.mock.calls.find(
        (call: unknown[]) => call[0] === "/api/log-food"
      );
      const body = JSON.parse((logCall![1] as { body: string }).body);
      expect(body.time).toBe("08:15");
    });

    it("uses current local time when no time is selected (Now mode)", async () => {
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

      // Don't set time — leave as null
      fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/log-food", expect.any(Object));
      });

      const logCall = mockFetch.mock.calls.find(
        (call: unknown[]) => call[0] === "/api/log-food"
      );
      const body = JSON.parse((logCall![1] as { body: string }).body);
      expect(body.time).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  // FOO-816: useAnalysisSession integration
  describe("analysis session persistence", () => {
    it("shows loading skeleton when isRestoring is true", () => {
      mockUseAnalysisSession.mockImplementation(() => ({
        ...useAnalysisSessionReal(),
        isRestoring: true,
      }));

      render(<FoodAnalyzer />);

      // Should NOT show the analyze form elements
      expect(screen.queryByTestId("photo-capture")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /analyze/i })).not.toBeInTheDocument();

      // Should show a loading skeleton
      expect(screen.getByTestId("restoring-skeleton")).toBeInTheDocument();
    });

    it("renders with restored state from hook", async () => {
      const restoredActions = {
        setPhotos: vi.fn(),
        setCompressedImages: vi.fn(),
        setDescription: vi.fn(),
        setAnalysis: vi.fn(),
        setAnalysisNarrative: vi.fn(),
        setMealTypeId: vi.fn(),
        setSelectedTime: vi.fn(),
        setMatches: vi.fn(),
        clearSession: vi.fn(),
        getActiveSessionId: vi.fn().mockReturnValue(null),
      };
      mockUseAnalysisSession.mockReturnValue({
        state: {
          photos: [new File(["photo"], "restored.jpg", { type: "image/jpeg" })],
          convertedPhotoBlobs: [],
          compressedImages: null,
          description: "restored description",
          analysis: mockAnalysis,
          analysisNarrative: "This is a narrative",
          mealTypeId: 5,
          selectedTime: null,
          matches: mockMatches,
        },
        actions: restoredActions,
        isRestoring: false,
        wasRestored: true,
      });

      render(<FoodAnalyzer />);

      // Should render the restored analysis
      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne");
        expect(screen.getByTestId("analysis-narrative")).toHaveTextContent("This is a narrative");
      });
    });

    it("calls actions.setPhotos when user captures photos", async () => {
      render(<FoodAnalyzer />);

      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

      await waitFor(() => {
        expect(sessionSpies.setPhotos).toHaveBeenCalled();
        const call = sessionSpies.setPhotos.mock.calls[0];
        expect(call[0]).toHaveLength(1);
        expect(call[0][0]).toBeInstanceOf(File);
      });
    });

    it("calls actions.setDescription when user types description", () => {
      render(<FoodAnalyzer />);

      const descInput = screen.getByTestId("description-input");
      fireEvent.change(descInput, { target: { value: "test food" } });

      expect(sessionSpies.setDescription).toHaveBeenCalledWith("test food");
    });

    it("calls actions.setAnalysis and setAnalysisNarrative when analysis completes", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSseAnalyzeResponse([
          { type: "text_delta", text: "This is narrative text" },
          { type: "analysis", analysis: mockAnalysis },
          { type: "done" },
        ])
      );

      render(<FoodAnalyzer />);

      // Add photo first
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
      });

      await waitFor(() => {
        expect(sessionSpies.setAnalysis).toHaveBeenCalledWith(mockAnalysis);
        expect(sessionSpies.setAnalysisNarrative).toHaveBeenCalled();
      });
    });
  });

  // FOO-817: Clear triggers
  describe("session clear", () => {
    it("clears session when user clicks Done after successful food log", async () => {
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

      fireEvent.click(screen.getByRole("button", { name: /done/i }));

      expect(mockClearSession).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/app");
    });

    it("Clear All triggers clearSession when photos are cleared", () => {
      render(<FoodAnalyzer />);

      // Add a photo first
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

      // Clear all photos (triggers onPhotosChange with empty array)
      fireEvent.click(screen.getByRole("button", { name: /clear photos/i }));

      expect(mockClearSession).toHaveBeenCalled();
    });

    it("passes restoredBlobs to PhotoCapture when session was restored with convertedPhotoBlobs", () => {
      const staticActions = {
        setPhotos: vi.fn(), setCompressedImages: vi.fn(), setDescription: vi.fn(),
        setAnalysis: vi.fn(), setAnalysisNarrative: vi.fn(), setMealTypeId: vi.fn(),
        setSelectedTime: vi.fn(), setMatches: vi.fn(), clearSession: vi.fn(),
        getActiveSessionId: vi.fn().mockReturnValue(null),
      };
      mockUseAnalysisSession.mockReturnValue({
        state: {
          photos: [],
          convertedPhotoBlobs: [new Blob(["photo1"]), new Blob(["photo2"])],
          compressedImages: null, description: "",
          analysis: null, analysisNarrative: null, mealTypeId: 3,
          selectedTime: null, matches: [],
        },
        actions: staticActions,
        isRestoring: false,
        wasRestored: true,
      });

      render(<FoodAnalyzer />);

      const photoCapture = screen.getByTestId("photo-capture");
      expect(photoCapture).toHaveAttribute("data-restored-count", "2");
      expect(screen.getByTestId("restored-photos-indicator")).toHaveTextContent("2 restored");
    });

    it("does NOT pass restoredBlobs when session was not restored", () => {
      render(<FoodAnalyzer />);

      const photoCapture = screen.getByTestId("photo-capture");
      expect(photoCapture).toHaveAttribute("data-restored-count", "0");
      expect(screen.queryByTestId("restored-photos-indicator")).not.toBeInTheDocument();
    });

  });

  // FOO-743: Client-side Sentry error reporting
  describe("FOO-743: Sentry.captureException in analyze catch block", () => {
    it("calls captureException for unexpected fetch error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));

      render(<FoodAnalyzer />);
      fireEvent.change(screen.getByTestId("description-input"), {
        target: { value: "test food" },
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText(/network failure/i)).toBeInTheDocument();
      });

      expect(mockCaptureExceptionAnalyzer).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Network failure" })
      );
    });

    it("does NOT call captureException for AbortError", async () => {
      const abortError = new Error("The operation was aborted.");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      render(<FoodAnalyzer />);
      fireEvent.change(screen.getByTestId("description-input"), {
        target: { value: "test food" },
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /analyze/i })).not.toBeDisabled();
      });

      expect(mockCaptureExceptionAnalyzer).not.toHaveBeenCalled();
    });

    it("does NOT call captureException for TimeoutError", async () => {
      const timeoutError = new DOMException("signal timed out", "TimeoutError");
      mockFetch.mockRejectedValueOnce(timeoutError);

      render(<FoodAnalyzer />);
      fireEvent.change(screen.getByTestId("description-input"), {
        target: { value: "test food" },
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByText(/analysis timed out/i)).toBeInTheDocument();
      });

      expect(mockCaptureExceptionAnalyzer).not.toHaveBeenCalled();
    });
  });

  describe("CTA label clarity (FOO-840)", () => {
    it("shows 'Log as new food' (not 'Log as new') when analysis exists with matches", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ...makeSseAnalyzeResponse([
            { type: "analysis", analysis: mockAnalysis },
            { type: "done" },
          ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: { matches: mockMatches } }),
        });

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      await waitFor(() => {
        const stickyBar = screen.getByTestId("sticky-cta-bar");
        expect(stickyBar).toHaveTextContent("Log as new food");
      });
    });

    it("shows contextual text explaining match reuse in the matches section", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ...makeSseAnalyzeResponse([
            { type: "analysis", analysis: mockAnalysis },
            { type: "done" },
          ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: { matches: mockMatches } }),
        });

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-match-card")).toBeInTheDocument();
      });

      expect(screen.getByText(/tap a match to reuse/i)).toBeInTheDocument();
    });
  });

  describe("cancel button during analysis (FOO-839)", () => {
    it("shows a Cancel button while loading", async () => {
      const { response, close } = makeControllableSseResponse();
      mockFetch.mockResolvedValueOnce(response);

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      });

      close();
    });

    it("clicking Cancel aborts analysis but preserves photos and description", async () => {
      // Use a fetch mock that rejects with AbortError when abort is called
      mockFetch.mockImplementationOnce((_url: string, options: RequestInit) => {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.change(screen.getByTestId("description-input"), {
        target: { value: "my food" },
      });
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      await waitFor(() => {
        // Loading state should clear — CTA should revert to "Analyze Food"
        expect(screen.getByRole("button", { name: /analyze food/i })).toBeInTheDocument();
      });

      // Photos and description should still be present
      expect(screen.getByTestId("photo-capture")).toBeInTheDocument();
      expect(screen.getByTestId("description-input")).toHaveValue("my food");
    });

    it("after canceling, CTA reverts to 'Analyze Food' for retry", async () => {
      mockFetch.mockImplementationOnce((_url: string, options: RequestInit) => {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      await waitFor(() => {
        const stickyBar = screen.getByTestId("sticky-cta-bar");
        expect(stickyBar).toHaveTextContent(/analyze food/i);
      });
    });
  });

  describe("re-analyze button (FOO-838)", () => {
    it("shows a Re-analyze button after analysis completes", async () => {
      mockFetch.mockResolvedValueOnce({
        ...makeSseAnalyzeResponse([
          { type: "analysis", analysis: mockAnalysis },
          { type: "done" },
        ]),
      });

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: /re-analyze/i })).toBeInTheDocument();
    });

    it("clicking Re-analyze triggers a new analysis", async () => {
      mockFetch
        // First analysis
        .mockResolvedValueOnce({
          ...makeSseAnalyzeResponse([
            { type: "analysis", analysis: mockAnalysis },
            { type: "done" },
          ]),
        })
        // First find-matches call after analysis
        .mockResolvedValueOnce(emptyMatchesResponse())
        // Second analysis (re-analyze)
        .mockResolvedValueOnce({
          ...makeSseAnalyzeResponse([
            { type: "analysis", analysis: { ...mockAnalysis, food_name: "Updated analysis" } },
            { type: "done" },
          ]),
        });

      render(<FoodAnalyzer />);
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      fireEvent.click(screen.getByRole("button", { name: /analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toHaveTextContent("Empanada de carne");
      });

      fireEvent.click(screen.getByRole("button", { name: /re-analyze/i }));

      await waitFor(() => {
        expect(screen.getByTestId("food-name")).toHaveTextContent("Updated analysis");
      });
    });

    it("Re-analyze button is not visible when no analysis exists", () => {
      render(<FoodAnalyzer />);
      expect(screen.queryByRole("button", { name: /re-analyze/i })).not.toBeInTheDocument();
    });
  });
});
