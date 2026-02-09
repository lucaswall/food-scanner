import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import { QuickSelect } from "../quick-select";
import type { CommonFood, FoodLogResponse } from "@/types";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock pending-submission
const mockSavePending = vi.fn();
const mockGetPending = vi.fn().mockReturnValue(null);
const mockClearPending = vi.fn();

vi.mock("@/lib/pending-submission", () => ({
  savePendingSubmission: (...args: unknown[]) => mockSavePending(...args),
  getPendingSubmission: () => mockGetPending(),
  clearPendingSubmission: () => mockClearPending(),
}));

// Mock meal-type
vi.mock("@/lib/meal-type", () => ({
  getDefaultMealType: () => 3,
  getLocalDateTime: () => ({ date: "2026-02-07", time: "14:30:00" }),
}));

// Mock nutrition-facts-card
vi.mock("../nutrition-facts-card", () => ({
  NutritionFactsCard: ({ foodName }: { foodName: string }) => (
    <div data-testid="nutrition-facts-card">
      <span>Nutrition Facts</span>
      <span>{foodName}</span>
    </div>
  ),
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock food-log-confirmation
vi.mock("../food-log-confirmation", () => ({
  FoodLogConfirmation: ({
    response,
    foodName,
    onDone,
  }: {
    response: FoodLogResponse | null;
    foodName: string;
    onDone: () => void;
  }) =>
    response ? (
      <div data-testid="food-log-confirmation">
        <span>Successfully logged {foodName}</span>
        <button data-testid="done-button" onClick={onDone}>Done</button>
      </div>
    ) : null,
}));

// Mock meal-type-selector
vi.mock("../meal-type-selector", () => ({
  MealTypeSelector: ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (id: number) => void;
  }) => (
    <div data-testid="meal-type-selector">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value="1">Breakfast</option>
        <option value="3">Lunch</option>
        <option value="5">Dinner</option>
      </select>
    </div>
  ),
}));

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
const MockIntersectionObserver = vi.fn(function (this: IntersectionObserver) {
  this.observe = mockObserve;
  this.disconnect = mockDisconnect;
  this.unobserve = vi.fn();
} as unknown as () => void);
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

const mockFoods: CommonFood[] = [
  {
    customFoodId: 1,
    foodName: "Empanada de carne",
    amount: 150,
    unitId: 147,
    calories: 320,
    proteinG: 12,
    carbsG: 28,
    fatG: 18,
    fiberG: 2,
    sodiumMg: 450,
    fitbitFoodId: 111,
    mealTypeId: 3,
  },
  {
    customFoodId: 2,
    foodName: "Cafe con leche",
    amount: 250,
    unitId: 209,
    calories: 120,
    proteinG: 6,
    carbsG: 10,
    fatG: 5,
    fiberG: 0,
    sodiumMg: 80,
    fitbitFoodId: 222,
    mealTypeId: 1,
  },
];

const mockLogResponse: FoodLogResponse = {
  success: true,
  fitbitFoodId: 111,
  fitbitLogId: 67890,
  reusedFood: true,
};

/** Helper to create a mock fetch response with paginated data */
function mockPaginatedResponse(foods: CommonFood[], nextCursor: { score: number; id: number } | null = null) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, data: { foods, nextCursor } }),
  };
}

function renderQuickSelect() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <QuickSelect />
    </SWRConfig>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPending.mockReturnValue(null);
  // Restore IntersectionObserver mock (clearAllMocks strips the implementation)
  MockIntersectionObserver.mockImplementation(function (this: IntersectionObserver) {
    this.observe = mockObserve;
    this.disconnect = mockDisconnect;
    this.unobserve = vi.fn();
  } as unknown as () => void);
});

describe("QuickSelect", () => {
  describe("tabs", () => {
    it("renders Suggested and Recent tabs", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /suggested/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /recent/i })).toBeInTheDocument();
      });
    });

    it("Suggested tab is active by default", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        const suggestedTab = screen.getByRole("button", { name: /suggested/i });
        expect(suggestedTab).toHaveAttribute("data-active", "true");
      });
    });

    it("switching to Recent tab fetches with tab=recent param", async () => {
      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods));

      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /recent/i }));

      await waitFor(() => {
        const recentCalls = mockFetch.mock.calls.filter(
          (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("tab=recent")
        );
        expect(recentCalls.length).toBeGreaterThan(0);
      });
    });

    it("both tabs render food cards with the same UI", async () => {
      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
        .mockResolvedValueOnce(mockPaginatedResponse([mockFoods[1]]));

      renderQuickSelect();

      // Suggested tab shows food cards
      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      // Switch to Recent
      fireEvent.click(screen.getByRole("button", { name: /recent/i }));

      await waitFor(() => {
        expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
      });
    });
  });

  it("renders loading state initially", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderQuickSelect();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders food cards when foods are returned", async () => {
    mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
    });
  });

  it("each card shows food name, amount+unit, calories", async () => {
    mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      expect(screen.getByText("150g")).toBeInTheDocument();
      expect(screen.getByText(/320/)).toBeInTheDocument();
    });
  });

  it("renders empty state when 0 results", async () => {
    mockFetch.mockResolvedValueOnce(mockPaginatedResponse([]));

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText(/no foods found/i)).toBeInTheDocument();
    });
  });

  it("tapping a food card shows confirmation with Log to Fitbit button", async () => {
    mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
      expect(screen.getByText("Nutrition Facts")).toBeInTheDocument();
    });
  });

  it("logging calls /api/log-food with reuseCustomFoodId", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
      });

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/log-food",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"reuseCustomFoodId":1'),
        })
      );
    });
  });

  it("after successful log, shows success screen", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
      });

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
    });
  });


  it("has back button from detail view to food list", async () => {
    mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    await waitFor(() => {
      // Should be back on food list
      expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
    });
  });

  it("logging sends date and time in request body", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
      });

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

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

  it("saves date and time in pending submission on FITBIT_TOKEN_INVALID", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" },
          }),
      });

    // Prevent actual navigation
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "", assign: vi.fn(), replace: vi.fn() },
    });

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

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

  it("pending resubmit sends date and time from pending data", async () => {
    mockGetPending.mockReturnValue({
      analysis: null,
      mealTypeId: 3,
      foodName: "Empanada de carne",
      reuseCustomFoodId: 1,
      date: "2026-02-06",
      time: "12:00:00",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockLogResponse }),
    });

    renderQuickSelect();

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

  it("pending resubmit falls back to getLocalDateTime when no saved date/time", async () => {
    mockGetPending.mockReturnValue({
      analysis: null,
      mealTypeId: 3,
      foodName: "Empanada de carne",
      reuseCustomFoodId: 1,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockLogResponse }),
    });

    renderQuickSelect();

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

  it("shows success immediately after tapping Log to Fitbit (optimistic UI)", async () => {
    // First mock returns food list, second mock delays (simulates network latency)
    let resolveLogFetch: ((value: unknown) => void) | null = null;
    mockFetch
      .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveLogFetch = resolve;
      }));

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    // FoodLogConfirmation should render immediately, BEFORE fetch resolves
    await waitFor(() => {
      expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
    });

    // Now resolve the fetch to clean up
    resolveLogFetch!({
      ok: true,
      json: () => Promise.resolve({ success: true, data: mockLogResponse }),
    });
  });

  it("shows cached data instantly on re-mount (SWR cache)", async () => {
    // Use a shared SWR cache across mounts
    const cache = new Map();

    mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));

    // First mount — loads data from fetch
    const { unmount } = render(
      <SWRConfig value={{ provider: () => cache }}>
        <QuickSelect />
      </SWRConfig>
    );

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Unmount
    unmount();
    cleanup();

    // Re-mount — should show data instantly from cache (no loading state)
    render(
      <SWRConfig value={{ provider: () => cache }}>
        <QuickSelect />
      </SWRConfig>
    );

    // Data should be visible immediately, no loading state
    expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  describe("infinite scroll", () => {
    it("does not include size in useEffect dependency array (functional updater)", async () => {
      // The IntersectionObserver callback should use setSize(s => s + 1)
      // (functional updater) instead of setSize(size + 1), so `size` should
      // NOT be in the useEffect dependency array. This prevents stale closures
      // and unnecessary re-subscriptions to the observer.
      // We verify this by checking that the observer is set up only once
      // even after the component receives data (which doesn't change size).
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods, { score: 0.5, id: 2 }));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      // Observer should have been set up exactly once (not re-created for size changes)
      expect(mockObserve).toHaveBeenCalledTimes(1);
    });
  });

  describe("search", () => {
    it("renders search input below tab bar", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search foods...")).toBeInTheDocument();
      });
    });

    it("does not fetch when query is less than 2 characters", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText("Search foods...");
      fireEvent.change(searchInput, { target: { value: "e" } });

      // Wait for debounce to settle (300ms + buffer)
      await new Promise((r) => setTimeout(r, 400));

      // No search-foods call should be made (only common-foods for initial load)
      const searchCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("/api/search-foods")
      );
      expect(searchCalls).toHaveLength(0);
    });

    it("fetches search results after debounce with 2+ chars", async () => {
      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { foods: [mockFoods[0]] },
          }),
        });

      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText("Search foods...");
      fireEvent.change(searchInput, { target: { value: "emp" } });

      // Before debounce fires — no search calls yet
      const searchCallsBefore = mockFetch.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("/api/search-foods")
      );
      expect(searchCallsBefore).toHaveLength(0);

      // After debounce settles, SWR should fire the search fetch
      await waitFor(() => {
        const searchCallsAfter = mockFetch.mock.calls.filter(
          (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("/api/search-foods")
        );
        expect(searchCallsAfter.length).toBeGreaterThan(0);
      });
    });

    it("shows search results replacing tab content", async () => {
      const searchResult: CommonFood = {
        customFoodId: 3,
        foodName: "Empanada de humita",
        amount: 150,
        unitId: 147,
        calories: 280,
        proteinG: 8,
        carbsG: 30,
        fatG: 14,
        fiberG: 3,
        sodiumMg: 350,
        fitbitFoodId: 333,
        mealTypeId: 3,
      };

      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { foods: [searchResult] },
          }),
        });

      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText("Search foods...");
      fireEvent.change(searchInput, { target: { value: "humita" } });

      await waitFor(() => {
        expect(screen.getByText("Empanada de humita")).toBeInTheDocument();
      });
    });

    it("returns to tab content when search input is cleared", async () => {
      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { foods: [mockFoods[0]] },
          }),
        });

      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
        expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText("Search foods...");

      // Type search query
      fireEvent.change(searchInput, { target: { value: "emp" } });

      // Wait for search to trigger
      await waitFor(() => {
        const searchCalls = mockFetch.mock.calls.filter(
          (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("/api/search-foods")
        );
        expect(searchCalls.length).toBeGreaterThan(0);
      });

      // Clear search
      fireEvent.change(searchInput, { target: { value: "" } });

      // Tab content should be back (SWR has cached data)
      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
        expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
      });
    });
  });
});
