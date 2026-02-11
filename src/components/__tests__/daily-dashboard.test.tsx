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

const mockLumenGoals = {
  goals: {
    date: "2026-02-10",
    dayType: "Low carb",
    proteinGoal: 120,
    carbsGoal: 50,
    fatGoal: 80,
  },
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

  it("renders dashboard with plain calorie display when goals fetch fails", async () => {
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
      // Dashboard should render without blocking on goals error
      expect(screen.queryByTestId("calorie-ring-svg")).not.toBeInTheDocument();
      expect(screen.getByText("1,200")).toBeInTheDocument();
      expect(screen.getByText("cal")).toBeInTheDocument();
    });

    // Other components should still render
    expect(screen.getByTestId("macro-bars")).toBeInTheDocument();
    expect(screen.getByText("Breakfast")).toBeInTheDocument();
  });

  it("renders dashboard with plain calorie display when goals.calories is null", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { calories: null } }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      // CalorieRing should NOT be rendered
      expect(screen.queryByTestId("calorie-ring-svg")).not.toBeInTheDocument();

      // Should show a plain calorie display with the total
      expect(screen.getByText("1,200")).toBeInTheDocument();
      expect(screen.getByText("cal")).toBeInTheDocument();
    });

    // Other dashboard components should still render
    expect(screen.getByTestId("macro-bars")).toBeInTheDocument();
    expect(screen.getByText("Breakfast")).toBeInTheDocument();
  });

  it("passes budget prop to CalorieRing when activity data is available", async () => {
    const mockActivity = {
      caloriesOut: 1800,
      estimatedCaloriesOut: 2200,
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockActivity }),
      });

    const { container } = renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("calorie-ring-svg")).toBeInTheDocument();
    });

    // Budget should be calculated as: caloriesOut - (estimatedCaloriesOut - goals.calories) - consumed
    // Budget = 1800 - (2200 - 2000) - 1200 = 1800 - 200 - 1200 = 400
    // Check that budget marker is rendered (indicates budget prop was passed)
    const budgetMarker = container.querySelector('[data-testid="budget-marker"]');
    expect(budgetMarker).toBeInTheDocument();
  });

  it("does not pass budget prop to CalorieRing when activity data is unavailable", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "UNKNOWN_ERROR", message: "Activity data unavailable" },
          }),
      });

    const { container } = renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("calorie-ring-svg")).toBeInTheDocument();
    });

    // Budget marker should NOT be rendered when activity data fails
    const budgetMarker = container.querySelector('[data-testid="budget-marker"]');
    expect(budgetMarker).not.toBeInTheDocument();
  });

  it("does not pass budget prop when goals.calories is null even if activity data exists", async () => {
    const mockActivity = {
      caloriesOut: 1800,
      estimatedCaloriesOut: 2200,
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { calories: null } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockActivity }),
      });

    const { container } = renderDailyDashboard();

    await waitFor(() => {
      // Should show plain display (no CalorieRing)
      expect(screen.queryByTestId("calorie-ring-svg")).not.toBeInTheDocument();
      expect(screen.getByText("1,200")).toBeInTheDocument();
    });

    // Budget marker should not exist (CalorieRing not rendered)
    const budgetMarker = container.querySelector('[data-testid="budget-marker"]');
    expect(budgetMarker).not.toBeInTheDocument();
  });

  it("shows reconnect message with link to settings when activity SWR returns error", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "FITBIT_SCOPE_MISSING", message: "Fitbit permissions need updating" },
          }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByText(/fitbit permissions need updating/i)).toBeInTheDocument();
    });

    // Should have a link to settings
    const settingsLink = screen.getByRole("link", { name: /settings/i });
    expect(settingsLink).toHaveAttribute("href", "/settings");
  });

  it("CalorieRing still renders without budget when activity SWR returns error", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "FITBIT_SCOPE_MISSING", message: "Fitbit permissions need updating" },
          }),
      });

    const { container } = renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("calorie-ring-svg")).toBeInTheDocument();
    });

    // Budget marker should NOT be rendered when activity data fails
    const budgetMarker = container.querySelector('[data-testid="budget-marker"]');
    expect(budgetMarker).not.toBeInTheDocument();
  });

  it("MacroBars and MealBreakdown still render when activity SWR returns error", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockSummary }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockGoals }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "FITBIT_SCOPE_MISSING", message: "Fitbit permissions need updating" },
          }),
      });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("macro-bars")).toBeInTheDocument();
      expect(screen.getByText("Breakfast")).toBeInTheDocument();
      expect(screen.getByText("Lunch")).toBeInTheDocument();
    });
  });

  it("fetches lumen-goals with today's date", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/nutrition-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockSummary }),
        });
      }
      if (url.includes("/api/nutrition-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockGoals }),
        });
      }
      if (url.includes("/api/lumen-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockLumenGoals }),
        });
      }
      if (url.includes("/api/activity-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { caloriesOut: 1800, estimatedCaloriesOut: 2200 } }),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    renderDailyDashboard();

    await waitFor(() => {
      const lumenGoalsCall = mockFetch.mock.calls.find((call) =>
        call[0].includes("/api/lumen-goals")
      );
      expect(lumenGoalsCall).toBeDefined();
      expect(lumenGoalsCall![0]).toMatch(/date=\d{4}-\d{2}-\d{2}/);
    });
  });

  it("passes goal props to MacroBars when Lumen goals exist", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/nutrition-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockSummary }),
        });
      }
      if (url.includes("/api/nutrition-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockGoals }),
        });
      }
      if (url.includes("/api/lumen-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockLumenGoals }),
        });
      }
      if (url.includes("/api/activity-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { caloriesOut: 1800, estimatedCaloriesOut: 2200 } }),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    renderDailyDashboard();

    await waitFor(() => {
      // When goals exist, MacroBars should show "current / goal" format
      expect(screen.getByText(/85 \/ 120g/)).toBeInTheDocument(); // Protein: 85 / 120g
      expect(screen.getByText(/200 \/ 50g/)).toBeInTheDocument(); // Carbs: 200 / 50g
      expect(screen.getByText(/50 \/ 80g/)).toBeInTheDocument(); // Fat: 50 / 80g
    });
  });

  it("shows day type text when Lumen goals exist", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/nutrition-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockSummary }),
        });
      }
      if (url.includes("/api/nutrition-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockGoals }),
        });
      }
      if (url.includes("/api/lumen-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockLumenGoals }),
        });
      }
      if (url.includes("/api/activity-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { caloriesOut: 1800, estimatedCaloriesOut: 2200 } }),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByText("Low carb day")).toBeInTheDocument();
    });
  });

  it("renders dashboard normally when Lumen goals fetch fails (graceful degradation)", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/nutrition-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockSummary }),
        });
      }
      if (url.includes("/api/nutrition-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockGoals }),
        });
      }
      if (url.includes("/api/lumen-goals")) {
        return Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              success: false,
              error: { code: "NOT_FOUND", message: "Lumen goals not found" },
            }),
        });
      }
      if (url.includes("/api/activity-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { caloriesOut: 1800, estimatedCaloriesOut: 2200 } }),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    renderDailyDashboard();

    await waitFor(() => {
      // Dashboard should render normally without Lumen goals
      expect(screen.getByTestId("macro-bars")).toBeInTheDocument();
      expect(screen.getByText("85g")).toBeInTheDocument(); // No goal suffix
      expect(screen.getByText("Breakfast")).toBeInTheDocument();
    });

    // Day type should NOT be shown
    expect(screen.queryByText(/day$/)).not.toBeInTheDocument();
  });

  it("MacroBars receives no goal props when Lumen goals are null", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/nutrition-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockSummary }),
        });
      }
      if (url.includes("/api/nutrition-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockGoals }),
        });
      }
      if (url.includes("/api/lumen-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { goals: null } }),
        });
      }
      if (url.includes("/api/activity-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { caloriesOut: 1800, estimatedCaloriesOut: 2200 } }),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("macro-bars")).toBeInTheDocument();
      // Should show current format without goals (e.g., "85g" not "85 / 120g")
      expect(screen.getByText("85g")).toBeInTheDocument();
      expect(screen.queryByText(/\/ \d+g/)).not.toBeInTheDocument();
    });
  });

  it("shows 'Update Lumen goals' button below MealBreakdown", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/nutrition-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockSummary }),
        });
      }
      if (url.includes("/api/nutrition-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockGoals }),
        });
      }
      if (url.includes("/api/lumen-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockLumenGoals }),
        });
      }
      if (url.includes("/api/activity-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { caloriesOut: 1800, estimatedCaloriesOut: 2200 } }),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /update lumen goals/i })).toBeInTheDocument();
    });
  });

  it("'Update Lumen goals' button triggers file picker on click", async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/nutrition-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockSummary }),
        });
      }
      if (url.includes("/api/nutrition-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockGoals }),
        });
      }
      if (url.includes("/api/lumen-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockLumenGoals }),
        });
      }
      if (url.includes("/api/activity-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { caloriesOut: 1800, estimatedCaloriesOut: 2200 } }),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /update lumen goals/i })).toBeInTheDocument();
    });

    const updateButton = screen.getByRole("button", { name: /update lumen goals/i });
    const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    const clickSpy = vi.spyOn(fileInput, "click");
    await user.click(updateButton);
    expect(clickSpy).toHaveBeenCalled();
  });

  it("POST to /api/lumen-goals includes date field in FormData body", async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/nutrition-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockSummary }),
        });
      }
      if (url.includes("/api/nutrition-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockGoals }),
        });
      }
      if (url.includes("/api/lumen-goals")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockLumenGoals }),
        });
      }
      if (url.includes("/api/activity-summary")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { caloriesOut: 1800, estimatedCaloriesOut: 2200 } }),
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    renderDailyDashboard();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /update lumen goals/i })).toBeInTheDocument();
    });

    // Create a test file
    const testFile = new File(["test"], "lumen.jpg", { type: "image/jpeg" });
    const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;

    // Simulate file selection
    await user.upload(fileInput, testFile);

    // Wait for POST request to be made
    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (call) => call[0] === "/api/lumen-goals" && call[1]?.method === "POST"
      );
      expect(postCall).toBeDefined();

      // Verify FormData contains date field
      const formData = postCall![1]?.body as FormData;
      expect(formData).toBeInstanceOf(FormData);
      const dateValue = formData.get("date");
      expect(dateValue).toBeDefined();
      expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD format
    });
  });
});
