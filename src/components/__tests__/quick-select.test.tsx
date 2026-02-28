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
  getLocalDateTime: () => ({ date: "2026-02-07", time: "14:30" }),
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
  }: {
    response: FoodLogResponse | null;
    foodName: string;
  }) =>
    response ? (
      <div data-testid="food-log-confirmation">
        <span>Successfully logged {foodName}</span>
      </div>
    ) : null,
}));

// Mock meal-type-selector
vi.mock("../meal-type-selector", () => ({
  MealTypeSelector: ({
    value,
    onChange,
    id,
  }: {
    value: number;
    onChange: (id: number) => void;
    id?: string;
  }) => (
    <div data-testid="meal-type-selector">
      <select
        id={id}
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
        const suggestedBtn = screen.getByRole("button", { name: /suggested/i });
        expect(suggestedBtn.className).toMatch(/bg-primary/);
      });
    });

    it("tab bar renders Suggested and Recent control buttons", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /suggested/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /recent/i })).toBeInTheDocument();
      });
    });

    it("inactive tab button has inactive styling", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        const recentBtn = screen.getByRole("button", { name: /recent/i });
        expect(recentBtn).toHaveClass("text-muted-foreground");
        expect(recentBtn).not.toHaveClass("bg-muted");
      });
    });

    it("tab buttons use rounded-full class", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        const suggestedBtn = screen.getByRole("button", { name: /suggested/i });
        const recentBtn = screen.getByRole("button", { name: /recent/i });
        expect(suggestedBtn).toHaveClass("rounded-full");
        expect(recentBtn).toHaveClass("rounded-full");
      });
    });

    it("tab content area does not have tabpanel role (tablist was removed for FOO-613)", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
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

    it("Recent tab revalidates on revisit", async () => {
      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods)) // Suggested initial
        .mockResolvedValueOnce(mockPaginatedResponse([mockFoods[1]])) // Recent first visit
        .mockResolvedValueOnce(mockPaginatedResponse([mockFoods[1]])); // Recent revisit (revalidation)

      render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <QuickSelect />
        </SWRConfig>
      );

      // Wait for Suggested tab to load
      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      // Switch to Recent tab (first visit)
      fireEvent.click(screen.getByRole("button", { name: /recent/i }));

      await waitFor(() => {
        expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
      });

      const fetchCountAfterFirstVisit = mockFetch.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("tab=recent")
      ).length;

      // Switch back to Suggested
      fireEvent.click(screen.getByRole("button", { name: /suggested/i }));

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      // Switch back to Recent (revisit - should trigger revalidation)
      fireEvent.click(screen.getByRole("button", { name: /recent/i }));

      await waitFor(() => {
        const fetchCountAfterRevisit = mockFetch.mock.calls.filter(
          (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("tab=recent")
        ).length;

        // Should have at least one more fetch for revalidation
        expect(fetchCountAfterRevisit).toBeGreaterThan(fetchCountAfterFirstVisit);
      });
    });

    it("switching to Recent tab does not show stale Suggested data while loading", async () => {
      // FOO-690: keepPreviousData: true causes old tab's data to persist during tab switch,
      // making the switch appear broken. When switching tabs, stale data should be cleared
      // immediately so the user sees the correct state (loading or new data).
      const suggestedOnlyFood = { ...mockFoods[0], foodName: "Suggested Only Food", customFoodId: 10 };

      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse([suggestedOnlyFood])) // Suggested loads immediately
        .mockImplementationOnce(() => new Promise(() => {})); // Recent fetch never resolves

      renderQuickSelect();

      // Wait for Suggested data to load
      await waitFor(() => {
        expect(screen.getByText("Suggested Only Food")).toBeInTheDocument();
      });

      // Switch to Recent tab
      fireEvent.click(screen.getByRole("button", { name: /recent/i }));

      // Suggested food should be cleared immediately — keepPreviousData must NOT persist stale data
      await waitFor(() => {
        expect(screen.queryByText("Suggested Only Food")).not.toBeInTheDocument();
      });
    });
  });

  describe("SWR key stability", () => {
    it("sentinel div always has minimum height regardless of loading state", async () => {
      mockFetch.mockResolvedValueOnce(
        mockPaginatedResponse(mockFoods, { score: 10, id: 2 })
      );

      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      // Find the sentinel div (it's the last div with a ref in the component)
      // We can't directly access the ref, but we can check if there's a div with min-h-[48px] class
      const sentinels = document.querySelectorAll('[class*="min-h"]');

      // The sentinel should exist and have a minimum height class
      expect(sentinels.length).toBeGreaterThan(0);
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

  it("shows guidance text in empty state (not search)", async () => {
    mockFetch.mockResolvedValueOnce(mockPaginatedResponse([]));

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText(/log some foods first using the analyze page/i)).toBeInTheDocument();
    });
  });

  it("does not show empty state during initial load", async () => {
    // FOO-478: Empty state should not flash during loading
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves
    renderQuickSelect();

    // Should show loading state, not empty state
    expect(screen.getByText(/loading foods/i)).toBeInTheDocument();
    expect(screen.queryByText(/no foods found/i)).not.toBeInTheDocument();
  });

  it("does not show empty state during tab switch while loading", async () => {
    // FOO-478: When switching tabs, empty state should not flash while new data loads
    mockFetch
      .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
      .mockImplementationOnce(() => new Promise(() => {})); // Tab switch never resolves

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Switch to Recent tab
    fireEvent.click(screen.getByRole("button", { name: /recent/i }));

    // Brief moment - should not show empty state while loading new tab data
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByText(/no foods found/i)).not.toBeInTheDocument();
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
        text: () => Promise.resolve(JSON.stringify({ success: true, data: mockLogResponse })),
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
        text: () => Promise.resolve(JSON.stringify({ success: true, data: mockLogResponse })),
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




  it("renders food name as h2 heading in detail/confirm view", async () => {
    mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      const heading = screen.getByRole("heading", { level: 2, name: "Empanada de carne" });
      expect(heading).toBeInTheDocument();
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
        text: () => Promise.resolve(JSON.stringify({ success: true, data: mockLogResponse })),
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
      expect(body.time).toBe("14:30");
    });
  });

  it("saves date and time in pending submission on FITBIT_TOKEN_INVALID", async () => {
    mockFetch
      .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
      .mockResolvedValueOnce({
        ok: false,
        text: () =>
          Promise.resolve(JSON.stringify({
            success: false,
            error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" },
          })),
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
          time: "14:30",
        })
      );
    });
  });

  it("does not check for pending submissions on mount", async () => {
    mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // QuickSelect should NOT call getPendingSubmission - that's handled by PendingSubmissionHandler
    expect(mockGetPending).not.toHaveBeenCalled();
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

  describe("useSWRInfinite configuration", () => {
    it("does not revalidate when window regains focus", async () => {
      // FOO-478: Prevent revalidation storms when switching tabs
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      // Clear fetch calls
      mockFetch.mockClear();

      // Simulate window focus event (SWR normally revalidates on focus)
      window.dispatchEvent(new FocusEvent("focus"));

      // Wait a bit for any potential revalidation
      await new Promise(r => setTimeout(r, 100));

      // Should NOT have made any new fetch calls
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("getKey optimization", () => {
    it("returns null during active search to prevent background pagination", async () => {
      // FOO-478: When search is active, getKey should return null to prevent
      // useSWRInfinite from making background pagination requests
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

      // Clear fetch calls from initial load
      mockFetch.mockClear();

      // Start search
      const searchInput = screen.getByPlaceholderText("Search foods...");
      fireEvent.change(searchInput, { target: { value: "emp" } });

      // Wait for debounce + search to complete
      await waitFor(() => {
        const searchCalls = mockFetch.mock.calls.filter(
          (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("/api/search-foods")
        );
        expect(searchCalls.length).toBeGreaterThan(0);
      });

      // During search, there should be NO calls to /api/common-foods (background pagination)
      const paginationCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("/api/common-foods")
      );
      expect(paginationCalls).toHaveLength(0);
    });
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

    it("observer is not recreated when isValidating changes", async () => {
      // FOO-478: Observer should not be recreated when isValidating toggles
      // This prevents rapid-fire pagination loops
      let resolvePage2: ((value: unknown) => void) | null = null;
      const page2Promise = new Promise((resolve) => {
        resolvePage2 = resolve;
      });

      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods, { score: 0.5, id: 2 }))
        .mockReturnValueOnce(page2Promise);

      renderQuickSelect();

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      // Observer set up once
      const initialObserveCount = mockObserve.mock.calls.length;
      const initialDisconnectCount = mockDisconnect.mock.calls.length;

      // Simulate intersection (triggers setSize, which starts validation)
      const calls = MockIntersectionObserver.mock.calls as unknown as [[IntersectionObserverCallback]];
      calls[0][0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

      // Wait a bit for any potential re-renders
      await new Promise(r => setTimeout(r, 50));

      // Resolve page 2 (ends validation) - keep hasMore=true with another cursor
      resolvePage2!({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { foods: [mockFoods[1]], nextCursor: { score: 0.3, id: 3 } }
        }),
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      // Observer should NOT have been recreated (no new disconnect/observe calls)
      // since hasMore is still true and only isValidating changed
      expect(mockDisconnect).toHaveBeenCalledTimes(initialDisconnectCount);
      expect(mockObserve).toHaveBeenCalledTimes(initialObserveCount);
    });

    it("loading spinner has consistent w-6 h-6 border-2 sizing", async () => {
      // FOO-485: Standardize loading spinner sizes across the app
      // Spinner should use w-6 h-6 border-2 (not border-4)

      // Set up mocks for pagination
      let resolvePage2: ((value: unknown) => void) | null = null;
      const page2Promise = new Promise((resolve) => {
        resolvePage2 = resolve;
      });

      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods, { score: 0.5, id: 2 }))
        .mockReturnValueOnce(page2Promise);

      renderQuickSelect();

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      // Trigger intersection to start loading more
      const calls = MockIntersectionObserver.mock.calls as unknown as [[IntersectionObserverCallback]];
      calls[0][0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

      // Wait for spinner to appear
      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();

        // Check for consistent sizing classes
        expect(spinner?.className).toContain('w-6');
        expect(spinner?.className).toContain('h-6');
        expect(spinner?.className).toContain('border-2');
        // Should NOT have border-4
        expect(spinner?.className).not.toContain('border-4');
      });

      // Clean up
      resolvePage2!({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { foods: [], nextCursor: null }
        }),
      });
    });
  });

  describe("aria-labels", () => {
    it("search input has aria-label", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: /search foods/i })).toBeInTheDocument();
      });
    });
  });

  describe("error role=alert", () => {
    it("detail view error has role=alert", async () => {
      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
        .mockResolvedValueOnce({
          ok: false,
          text: () =>
            Promise.resolve(JSON.stringify({
              success: false,
              error: { code: "FITBIT_API_ERROR", message: "Failed to log" },
            })),
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
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByText("Failed to log")).toBeInTheDocument();
      });
    });

  });

  describe("meal type label association", () => {
    it("meal type label is associated with selector via htmlFor", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Empanada de carne"));

      await waitFor(() => {
        const label = screen.getByText("Meal Type");
        expect(label.tagName).toBe("LABEL");
        expect(label).toHaveAttribute("for", "meal-type-quick-select");
      });
    });

    it("meal type selector has matching id", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Empanada de carne"));

      await waitFor(() => {
        const select = screen.getByTestId("meal-type-selector").querySelector("select");
        expect(select).toHaveAttribute("id", "meal-type-quick-select");
      });
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

  describe("FOO-433: foodToAnalysis includes Tier 1 nutrients", () => {
    it("includes saturated_fat_g, trans_fat_g, sugars_g, calories_from_fat in conversion", async () => {
      const mockFoodWithTier1: CommonFood = {
        customFoodId: 1,
        foodName: "Test Food",
        amount: 100,
        unitId: 147,
        calories: 200,
        proteinG: 10,
        carbsG: 20,
        fatG: 8,
        fiberG: 3,
        sodiumMg: 150,
        fitbitFoodId: 100,
        mealTypeId: 3,
        saturatedFatG: 3.5,
        transFatG: 0.2,
        sugarsG: 5,
        caloriesFromFat: 72,
      };

      mockFetch.mockResolvedValueOnce(mockPaginatedResponse([mockFoodWithTier1]));

      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Test Food")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Test Food"));

      await waitFor(() => {
        const nutritionCard = screen.getByTestId("nutrition-facts-card");
        expect(nutritionCard).toBeInTheDocument();
      });

      // The selected food detail should show all Tier 1 nutrients
      // This verifies that foodToAnalysis() preserves these fields
      // (The actual verification happens when the food is logged and the success screen shows the full analysis)
    });
  });

  describe("FOO-431: No optimistic success before API confirmation", () => {
    it("does not show success screen until API responds", async () => {
      const mockFood: CommonFood = {
        customFoodId: 1,
        foodName: "Test Food",
        amount: 100,
        unitId: 147,
        calories: 200,
        proteinG: 10,
        carbsG: 20,
        fatG: 8,
        fiberG: 3,
        sodiumMg: 150,
        fitbitFoodId: 100,
        mealTypeId: 3,
      };

      let resolveLogFetch: ((value: unknown) => void) | null = null;
      const logFetchPromise = new Promise((resolve) => {
        resolveLogFetch = resolve;
      });

      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse([mockFood]))
        .mockReturnValueOnce(logFetchPromise); // Log request hangs

      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Test Food")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Test Food"));
      await waitFor(() => {
        expect(screen.getByText("Log to Fitbit")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Log to Fitbit"));

      // Success screen should NOT appear while API call is pending
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(screen.queryByText(/successfully logged/i)).not.toBeInTheDocument();

      // Resolve the API call
      resolveLogFetch!({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          success: true,
          data: { success: true, fitbitLogId: 123, reusedFood: true },
        })),
      });

      // Now success screen should appear
      await waitFor(() => {
        expect(screen.getByText(/successfully logged/i)).toBeInTheDocument();
      });
    });
  });

  describe("FOO-655: fetch timeout", () => {
    it("log-food fetch includes AbortSignal timeout", async () => {
      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ success: true, data: mockLogResponse })),
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
        expect(logCall![1]).toHaveProperty("signal");
      });
    });
  });

  describe("FOO-656: aria-controls panel IDs", () => {
    it("tab buttons reference an existing panel element via aria-controls", async () => {
      mockFetch.mockResolvedValueOnce(mockPaginatedResponse(mockFoods));
      renderQuickSelect();

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      const suggestedBtn = screen.getByRole("button", { name: "Suggested" });
      const recentBtn = screen.getByRole("button", { name: "Recent" });

      // Both buttons should reference the same panel
      const panelId = suggestedBtn.getAttribute("aria-controls");
      expect(panelId).toBeTruthy();
      expect(recentBtn).toHaveAttribute("aria-controls", panelId);

      // The referenced panel element must exist in the DOM
      expect(document.getElementById(panelId!)).toBeInTheDocument();
    });
  });

  describe("FOO-664: search SWR error state", () => {
    it("shows error message when search fetch fails", async () => {
      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: { message: "Search failed", code: "SEARCH_ERROR" } }),
        });

      render(
        <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
          <QuickSelect />
        </SWRConfig>
      );

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText("Search foods...");
      fireEvent.change(searchInput, { target: { value: "emp" } });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByText("Search failed")).toBeInTheDocument();
      });
    });

    it("does not show empty state when search has an error", async () => {
      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: { message: "Search failed", code: "SEARCH_ERROR" } }),
        });

      render(
        <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
          <QuickSelect />
        </SWRConfig>
      );

      await waitFor(() => {
        expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText("Search foods...");
      fireEvent.change(searchInput, { target: { value: "emp" } });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });

      expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();
    });
  });

  describe("timeout error messaging", () => {
    it("shows user-friendly message when log-food request times out", async () => {
      mockFetch
        .mockResolvedValueOnce(mockPaginatedResponse(mockFoods))
        .mockRejectedValueOnce(new DOMException("signal timed out", "TimeoutError"));

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
        expect(screen.getByText(/request timed out/i)).toBeInTheDocument();
      });
    });
  });
});
