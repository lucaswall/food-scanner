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
});

describe("QuickSelect", () => {
  it("renders loading state initially", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderQuickSelect();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders food cards when foods are returned", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
    });

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
    });
  });

  it("each card shows food name, amount+unit, calories", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
    });

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      expect(screen.getByText("150g")).toBeInTheDocument();
      expect(screen.getByText(/320/)).toBeInTheDocument();
    });
  });

  it("renders empty state when 0 results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: [] } }),
    });

    renderQuickSelect();

    await waitFor(() => {
      expect(screen.getByText(/no recent foods/i)).toBeInTheDocument();
    });
  });

  it("tapping a food card shows confirmation with Log to Fitbit button", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
    });

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
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
      })
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
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
      })
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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
    });

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
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
      })
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
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
      })
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
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
      })
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

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
    });

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
});
