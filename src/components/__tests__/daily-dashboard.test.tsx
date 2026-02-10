import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import userEvent from "@testing-library/user-event";
import { DailyDashboard } from "../daily-dashboard";

// Mock ResizeObserver for UI components
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockSummary = {
  date: "2026-02-10",
  totals: {
    calories: 1200,
    proteinG: 85,
    carbsG: 200,
    fatG: 50,
    fiberG: 10,
    sodiumMg: 800,
    saturatedFatG: 5,
    transFatG: 0,
    sugarsG: 20,
    caloriesFromFat: 450,
  },
  meals: [
    {
      mealTypeId: 1,
      subtotal: {
        calories: 450,
        proteinG: 30,
        carbsG: 80,
        fatG: 15,
        fiberG: 5,
        sodiumMg: 300,
        saturatedFatG: 2,
        transFatG: 0,
        sugarsG: 10,
        caloriesFromFat: 135,
      },
      entries: [
        {
          id: 1,
          foodName: "Oatmeal",
          time: "08:00",
          calories: 300,
          proteinG: 10,
          carbsG: 50,
          fatG: 8,
          fiberG: 4,
          sodiumMg: 100,
          saturatedFatG: 1,
          transFatG: 0,
          sugarsG: 5,
          caloriesFromFat: 72,
        },
        {
          id: 2,
          foodName: "Banana",
          time: "08:15",
          calories: 150,
          proteinG: 20,
          carbsG: 30,
          fatG: 7,
          fiberG: 1,
          sodiumMg: 200,
          saturatedFatG: 1,
          transFatG: 0,
          sugarsG: 5,
          caloriesFromFat: 63,
        },
      ],
    },
    {
      mealTypeId: 3,
      subtotal: {
        calories: 750,
        proteinG: 55,
        carbsG: 120,
        fatG: 35,
        fiberG: 5,
        sodiumMg: 500,
        saturatedFatG: 3,
        transFatG: 0,
        sugarsG: 10,
        caloriesFromFat: 315,
      },
      entries: [
        {
          id: 3,
          foodName: "Chicken Salad",
          time: "12:30",
          calories: 750,
          proteinG: 55,
          carbsG: 120,
          fatG: 35,
          fiberG: 5,
          sodiumMg: 500,
          saturatedFatG: 3,
          transFatG: 0,
          sugarsG: 10,
          caloriesFromFat: 315,
        },
      ],
    },
  ],
};

const mockGoals = {
  calories: 2000,
};

function renderDailyDashboard() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <DailyDashboard />
    </SWRConfig>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DailyDashboard", () => {
  it("fetches from /api/nutrition-summary and /api/nutrition-goals", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const summaryCall = calls.find((call) => call[0].includes("/api/nutrition-summary"));
      const goalsCall = calls.find((call) => call[0].includes("/api/nutrition-goals"));

      expect(summaryCall).toBeDefined();
      expect(goalsCall).toBeDefined();
    });
  });

  it("nutrition-summary includes today's date in YYYY-MM-DD format", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      const summaryCall = mockFetch.mock.calls.find((call) =>
        call[0].includes("/api/nutrition-summary")
      );
      expect(summaryCall).toBeDefined();
      expect(summaryCall![0]).toMatch(/date=\d{4}-\d{2}-\d{2}/);
    });
  });

  it("shows skeleton loading state while fetching", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    renderDailyDashboard();

    // Should show skeleton placeholders
    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
  });

  it("renders CalorieRing with fetched data", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("calorie-ring-svg")).toBeInTheDocument();
      expect(screen.getByText("1,200")).toBeInTheDocument();
      expect(screen.getByText("/ 2,000 cal")).toBeInTheDocument();
    });
  });

  it("renders MacroBars with fetched macro totals", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("macro-bars")).toBeInTheDocument();
      expect(screen.getByText("85g")).toBeInTheDocument(); // Protein
      expect(screen.getByText("200g")).toBeInTheDocument(); // Carbs
      expect(screen.getByText("50g")).toBeInTheDocument(); // Fat
    });
  });

  it("renders MealBreakdown with fetched meal groups", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByText("Breakfast")).toBeInTheDocument();
      expect(screen.getByText("Lunch")).toBeInTheDocument();
      expect(screen.getByText("450 cal")).toBeInTheDocument();
      expect(screen.getByText("750 cal")).toBeInTheDocument();
    });
  });

  it("meal entries are initially collapsed", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByText("Breakfast")).toBeInTheDocument();
    });

    // Entries should not be visible initially
    expect(screen.queryByText("Oatmeal")).not.toBeInTheDocument();
    expect(screen.queryByText("Banana")).not.toBeInTheDocument();
  });

  it("clicking a meal header expands it", async () => {
    const user = userEvent.setup();

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByText("Breakfast")).toBeInTheDocument();
    });

    // Expand Breakfast
    const breakfastHeader = screen.getByTestId("meal-header-1");
    await user.click(breakfastHeader);

    expect(screen.getByText("Oatmeal")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });

  it("shows empty state when summary returns zero entries", async () => {
    const emptySummary = {
      date: "2026-02-10",
      totals: {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sodiumMg: 0,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
      meals: [],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: emptySummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByText(/no food logged today/i)).toBeInTheDocument();
    });
  });

  it("empty state includes link to scan food", async () => {
    const emptySummary = {
      date: "2026-02-10",
      totals: {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sodiumMg: 0,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
      meals: [],
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: emptySummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByText(/no food logged today/i)).toBeInTheDocument();
    });

    // Should have a link or button to scan food
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app");
  });

  it("shows error state when summary fetch fails", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "UNKNOWN_ERROR", message: "Failed to load" },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });
  });

  it("shows error state when goals fetch fails", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "UNKNOWN_ERROR", message: "Failed to load goals" },
          }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByText(/failed to load goals/i)).toBeInTheDocument();
    });
  });
});
