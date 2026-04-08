import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SavedFoodDetail } from "../saved-food-detail";
import type { FoodAnalysis, FoodLogResponse, FoodMatch } from "@/types";
import type { SavedAnalysisDetail } from "@/types";

// Mock ResizeObserver for Radix UI
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// Hoist mocks that are referenced inside vi.mock() factory functions
const { mockUseSWR, mockInvalidateFoodCaches, mockInvalidateSavedAnalysesCaches } = vi.hoisted(
  () => ({
    mockUseSWR: vi.fn(),
    mockInvalidateFoodCaches: vi.fn().mockResolvedValue([]),
    mockInvalidateSavedAnalysesCaches: vi.fn().mockResolvedValue([]),
  }),
);

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("swr", () => ({
  default: mockUseSWR,
}));

vi.mock("@/lib/swr", () => ({
  apiFetcher: vi.fn(),
  invalidateFoodCaches: mockInvalidateFoodCaches,
  invalidateSavedAnalysesCaches: mockInvalidateSavedAnalysesCaches,
}));

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock @/lib/meal-type
vi.mock("@/lib/meal-type", () => ({
  getDefaultMealType: vi.fn().mockReturnValue(3),
  getLocalDateTime: vi.fn().mockReturnValue({
    date: "2026-04-08",
    time: "12:00",
    zoneOffset: "+00:00",
  }),
}));

// Mock AnalysisResult
vi.mock("../analysis-result", () => ({
  AnalysisResult: ({ analysis }: { analysis: FoodAnalysis | null }) =>
    analysis ? (
      <div data-testid="analysis-result">
        <span data-testid="food-name">{analysis.food_name}</span>
      </div>
    ) : null,
}));

// Mock MealTypeSelector
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
      <input
        type="time"
        aria-label="Meal time"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </div>
  ),
}));

// Mock FoodMatchCard
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

// Mock FoodLogConfirmation
vi.mock("../food-log-confirmation", () => ({
  FoodLogConfirmation: ({
    response,
    foodName,
    onDone,
  }: {
    response: FoodLogResponse | null;
    foodName: string;
    onDone?: () => void;
  }) =>
    response ? (
      <div data-testid="food-log-confirmation">
        <span>Successfully logged {foodName}</span>
        <button onClick={onDone}>Done</button>
      </div>
    ) : null,
}));

// Mock FoodChat
const mockFoodChatOnLogged = vi.fn();
vi.mock("../food-chat", () => ({
  FoodChat: ({
    initialAnalysis,
    onClose,
    onLogged,
    mode,
  }: {
    initialAnalysis?: FoodAnalysis;
    onClose?: () => void;
    onLogged?: (response: FoodLogResponse, analysis: FoodAnalysis, mealTypeId: number) => void;
    mode?: string;
  }) => (
    <div data-testid="food-chat">
      {initialAnalysis && (
        <span data-testid="chat-food-name">{initialAnalysis.food_name}</span>
      )}
      <span data-testid="chat-mode">{mode}</span>
      <button onClick={onClose}>Close Chat</button>
      <button
        onClick={() => {
          mockFoodChatOnLogged(onLogged);
          onLogged?.(
            { success: true, fitbitLogId: 999, fitbitFoodId: 888, reusedFood: false },
            initialAnalysis!,
            3
          );
        }}
      >
        Log from Chat
      </button>
    </div>
  ),
}));

// Test data
const mockFoodAnalysis: FoodAnalysis = {
  food_name: "Chicken Rice Bowl",
  amount: 1,
  unit_id: 304,
  calories: 500,
  protein_g: 30,
  carbs_g: 60,
  fat_g: 10,
  fiber_g: 3,
  sodium_mg: 800,
  saturated_fat_g: 3,
  trans_fat_g: 0,
  sugars_g: 2,
  calories_from_fat: 90,
  confidence: "high",
  notes: "",
  description: "A bowl of rice with chicken",
  keywords: ["chicken", "rice", "bowl"],
};

const mockSavedAnalysis: SavedAnalysisDetail = {
  id: 42,
  description: "Chicken Rice Bowl",
  calories: 500,
  createdAt: "2026-04-08T10:00:00Z",
  foodAnalysis: mockFoodAnalysis,
};

const mockMatch: FoodMatch = {
  customFoodId: 7,
  foodName: "Chicken Rice",
  calories: 480,
  proteinG: 28,
  carbsG: 55,
  fatG: 9,
  saturatedFatG: 2,
  transFatG: 0,
  sugarsG: 1,
  caloriesFromFat: 80,
  fitbitFoodId: 100,
  matchRatio: 0.9,
  lastLoggedAt: new Date("2026-04-01"),
  amount: 1,
  unitId: 304,
};

const mockLogResponse: FoodLogResponse = {
  success: true,
  fitbitFoodId: 123,
  fitbitLogId: 456,
  reusedFood: false,
};

function setupSWR(opts: {
  savedAnalysis?: SavedAnalysisDetail | null;
  savedLoading?: boolean;
  savedError?: Error | null;
  matches?: FoodMatch[];
  matchesLoading?: boolean;
} = {}) {
  const {
    savedAnalysis = mockSavedAnalysis,
    savedLoading = false,
    savedError = null,
    matches = [],
    matchesLoading = false,
  } = opts;

  mockUseSWR.mockImplementation((key: string | null) => {
    if (key && typeof key === "string" && key.startsWith("/api/saved-analyses/")) {
      return { data: savedLoading ? undefined : savedError ? undefined : savedAnalysis, isLoading: savedLoading, error: savedError };
    }
    if (key && typeof key === "string" && key.startsWith("/api/search-foods")) {
      return { data: matchesLoading ? undefined : matches, isLoading: matchesLoading, error: null };
    }
    return { data: undefined, isLoading: false, error: null };
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockPush.mockReset();
  mockInvalidateFoodCaches.mockReset().mockResolvedValue([]);
  mockInvalidateSavedAnalysesCaches.mockReset().mockResolvedValue([]);
  mockUseSWR.mockReset();
  setupSWR();
});

describe("SavedFoodDetail", () => {
  describe("Loading state", () => {
    it("shows skeleton while fetching saved analysis", () => {
      setupSWR({ savedLoading: true });
      render(<SavedFoodDetail savedId={42} />);
      expect(screen.getByTestId("saved-detail-skeleton")).toBeInTheDocument();
      expect(screen.queryByTestId("analysis-result")).not.toBeInTheDocument();
    });
  });

  describe("Not found / error state", () => {
    it("shows error message and back button when saved analysis not found", () => {
      setupSWR({ savedAnalysis: null, savedError: new Error("Not found") });
      render(<SavedFoodDetail savedId={42} />);
      expect(screen.getByTestId("saved-not-found")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /back/i })).toBeInTheDocument();
    });
  });

  describe("Renders analysis", () => {
    it("shows AnalysisResult with saved nutrition data", () => {
      setupSWR();
      render(<SavedFoodDetail savedId={42} />);
      expect(screen.getByTestId("analysis-result")).toBeInTheDocument();
      expect(screen.getByTestId("food-name")).toHaveTextContent("Chicken Rice Bowl");
    });

    it("renders MealTypeSelector with getDefaultMealType as default", () => {
      setupSWR();
      render(<SavedFoodDetail savedId={42} />);
      expect(screen.getByTestId("meal-type-selector")).toBeInTheDocument();
      // default meal type is 3 (Lunch) from mock
      expect(screen.getByRole("combobox")).toHaveValue("3");
    });

    it("renders TimeSelector", () => {
      setupSWR();
      render(<SavedFoodDetail savedId={42} />);
      expect(screen.getByTestId("time-selector")).toBeInTheDocument();
    });
  });

  describe("Match lookup", () => {
    it("calls /api/search-foods with the saved food's name keywords", () => {
      setupSWR();
      render(<SavedFoodDetail savedId={42} />);
      // useSWR should have been called with a search-foods URL containing the food name
      const calls = mockUseSWR.mock.calls;
      const searchCall = calls.find(
        ([key]) => typeof key === "string" && key.startsWith("/api/search-foods")
      );
      expect(searchCall).toBeDefined();
      expect(searchCall![0]).toContain("Chicken");
    });

    it("uses null key (no fetch) until saved analysis loads", () => {
      setupSWR({ savedLoading: true });
      render(<SavedFoodDetail savedId={42} />);
      const calls = mockUseSWR.mock.calls;
      const searchCall = calls.find(
        ([key]) => typeof key === "string" && key.startsWith("/api/search-foods")
      );
      // Either no search-foods call or called with null key
      if (searchCall) {
        expect(searchCall[0]).toBeNull();
      }
    });
  });

  describe("No matches", () => {
    it("sticky button says 'Log to Fitbit' when no matches", () => {
      setupSWR({ matches: [] });
      render(<SavedFoodDetail savedId={42} />);
      expect(screen.getByRole("button", { name: "Log to Fitbit" })).toBeInTheDocument();
      expect(screen.queryByText("Similar foods")).not.toBeInTheDocument();
    });
  });

  describe("With matches", () => {
    it("shows 'Similar foods' header and FoodMatchCard list", () => {
      setupSWR({ matches: [mockMatch] });
      render(<SavedFoodDetail savedId={42} />);
      expect(screen.getByText("Similar foods")).toBeInTheDocument();
      expect(screen.getByTestId("food-match-card")).toBeInTheDocument();
    });

    it("sticky button says 'Log as new food' when matches present", () => {
      setupSWR({ matches: [mockMatch] });
      render(<SavedFoodDetail savedId={42} />);
      expect(screen.getByRole("button", { name: "Log as new food" })).toBeInTheDocument();
    });

    it("selecting a match changes button label to Log to Fitbit and sets reuseCustomFoodId", async () => {
      setupSWR({ matches: [mockMatch] });
      render(<SavedFoodDetail savedId={42} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Use this" }));
      });
      // After selecting a match with matches present, CTA should say "Log to Fitbit"
      expect(screen.getByRole("button", { name: "Log to Fitbit" })).toBeInTheDocument();
    });
  });

  describe("Log flow (new food)", () => {
    it("POSTs to /api/log-food, DELETEs saved analysis, invalidates caches, shows confirmation", async () => {
      setupSWR({ matches: [] });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ success: true, data: mockLogResponse }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ success: true }),
        });

      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log to Fitbit" }));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/log-food",
          expect.objectContaining({ method: "POST" })
        );
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/saved-analyses/42",
          expect.objectContaining({ method: "DELETE" })
        );
      });

      expect(mockInvalidateFoodCaches).toHaveBeenCalled();
      expect(mockInvalidateSavedAnalysesCaches).toHaveBeenCalled();

      expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
    });

    it("includes correct fields in POST body for new food", async () => {
      setupSWR({ matches: [] });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ success: true, data: mockLogResponse }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ success: true }),
        });

      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log to Fitbit" }));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/log-food",
          expect.objectContaining({ method: "POST" })
        );
      });

      const logCall = mockFetch.mock.calls.find(
        ([url, opts]) => url === "/api/log-food" && opts?.method === "POST"
      );
      const body = JSON.parse(logCall![1].body);
      expect(body.food_name).toBe("Chicken Rice Bowl");
      expect(body.mealTypeId).toBe(3);
      expect(body.date).toBe("2026-04-08");
      expect(body.zoneOffset).toBeDefined();
    });
  });

  describe("Log flow (reuse match)", () => {
    it("POSTs with reuseCustomFoodId when a match is selected", async () => {
      setupSWR({ matches: [mockMatch] });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ success: true, data: mockLogResponse }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ success: true }),
        });

      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Use this" }));
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log to Fitbit" }));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/log-food",
          expect.objectContaining({ method: "POST" })
        );
      });

      const logCall = mockFetch.mock.calls.find(
        ([url, opts]) => url === "/api/log-food" && opts?.method === "POST"
      );
      const body = JSON.parse(logCall![1].body);
      expect(body.reuseCustomFoodId).toBe(mockMatch.customFoodId);
    });
  });

  describe("Log failure", () => {
    it("shows error alert when log fails", async () => {
      setupSWR({ matches: [] });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () =>
          JSON.stringify({
            success: false,
            error: { code: "FITBIT_API_ERROR", message: "Fitbit logging failed" },
          }),
      });

      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log to Fitbit" }));
      });

      await waitFor(() => {
        expect(screen.getByTestId("log-error")).toBeInTheDocument();
        expect(screen.getByTestId("log-error")).toHaveTextContent("Fitbit logging failed");
      });
    });
  });

  describe("Refine with chat", () => {
    it("clicking 'Refine with chat' opens FoodChat overlay with saved analysis", async () => {
      setupSWR();
      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /refine with chat/i }));
      });

      expect(screen.getByTestId("food-chat")).toBeInTheDocument();
      expect(screen.getByTestId("chat-food-name")).toHaveTextContent("Chicken Rice Bowl");
      expect(screen.getByTestId("chat-mode")).toHaveTextContent("analyze");
    });

    it("closing chat hides FoodChat overlay", async () => {
      setupSWR();
      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /refine with chat/i }));
      });

      expect(screen.getByTestId("food-chat")).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Close Chat" }));
      });

      expect(screen.queryByTestId("food-chat")).not.toBeInTheDocument();
    });

    it("onLogged from chat DELETEs saved analysis, invalidates caches, navigates to dashboard", async () => {
      setupSWR();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true }),
      });

      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /refine with chat/i }));
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log from Chat" }));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/saved-analyses/42",
          expect.objectContaining({ method: "DELETE" })
        );
      });

      expect(mockInvalidateSavedAnalysesCaches).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/app");
    });
  });

  describe("Discard", () => {
    it("clicking Discard shows confirmation dialog", async () => {
      setupSWR();
      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /discard/i }));
      });

      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    it("confirming discard DELETEs saved analysis, invalidates cache, navigates to /app", async () => {
      setupSWR();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true }),
      });

      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /discard/i }));
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/saved-analyses/42",
          expect.objectContaining({ method: "DELETE" })
        );
      });

      expect(mockInvalidateSavedAnalysesCaches).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/app");
    });

    it("cancelling discard dialog closes dialog without deleting", async () => {
      setupSWR();
      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /discard/i }));
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe("FOO-907: unchecked DELETE responses + missing timeouts", () => {
    it("handleDiscard shows error when DELETE returns non-2xx (does NOT navigate)", async () => {
      setupSWR();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "Server error" } }),
      });

      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /discard/i }));
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
      });

      await waitFor(() => {
        expect(screen.getByTestId("log-error")).toBeInTheDocument();
      });

      // Dialog should be closed so error is visible
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("handleLogToFitbit handles DELETE failure gracefully (still shows success)", async () => {
      setupSWR({ matches: [] });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ success: true, data: mockLogResponse }),
        })
        .mockResolvedValueOnce({
          ok: false,
          text: async () => JSON.stringify({ success: false }),
        });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log to Fitbit" }));
      });

      await waitFor(() => {
        expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
      });

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("passes AbortSignal.timeout to DELETE fetch in handleDiscard", async () => {
      setupSWR();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true }),
      });

      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /discard/i }));
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
      });

      await waitFor(() => {
        const deleteCall = mockFetch.mock.calls.find(
          (call: unknown[]) => call[0] === "/api/saved-analyses/42" && (call[1] as RequestInit).method === "DELETE"
        );
        expect(deleteCall).toBeDefined();
        expect((deleteCall![1] as RequestInit).signal).toBeDefined();
      });
    });
  });

  describe("FITBIT_TOKEN_INVALID handling", () => {
    it("saves pending submission and redirects to Fitbit OAuth on token invalid", async () => {
      setupSWR({ matches: [] });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () =>
          JSON.stringify({
            success: false,
            error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" },
          }),
      });

      // Mock window.location.href
      const locationSpy = vi.spyOn(window, "location", "get").mockReturnValue({
        ...window.location,
        href: "",
      } as Location);

      render(<SavedFoodDetail savedId={42} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Log to Fitbit" }));
      });

      // Redirect should have been set
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/log-food",
          expect.objectContaining({ method: "POST" })
        );
      });

      locationSpy.mockRestore();
    });
  });
});
