import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeeklyDashboard } from "@/components/weekly-dashboard";
import type { DailyNutritionTotals, FastingWindow } from "@/types";

// Mock SWR
vi.mock("swr", () => ({
  default: vi.fn((key: string) => {
    if (key?.includes("/api/nutrition-summary")) {
      return {
        data: {
          days: [
            {
              date: "2026-02-08",
              calories: 2000,
              proteinG: 120,
              carbsG: 200,
              fatG: 60,
              fiberG: 25,
              sodiumMg: 2000,
              calorieGoal: 2000,
            },
          ],
        },
        error: null,
        isLoading: false,
      };
    }
    if (key?.includes("/api/fasting")) {
      return {
        data: {
          windows: [
            {
              date: "2026-02-08",
              lastMealTime: "20:00:00",
              firstMealTime: "12:00:00",
              durationMinutes: 960,
            },
          ],
        },
        error: null,
        isLoading: false,
      };
    }
    return { data: null, error: null, isLoading: true };
  }),
}));

// Mock date utils
vi.mock("@/lib/date-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date-utils")>();
  return {
    ...actual,
    getTodayDate: () => "2026-02-12", // Wednesday
    getWeekBounds: (date: string) => {
      if (date === "2026-02-12") {
        return { start: "2026-02-08", end: "2026-02-14" };
      }
      return { start: date, end: date };
    },
  };
});

// Mock child components
vi.mock("@/components/week-navigator", () => ({
  WeekNavigator: ({ weekStart, onWeekChange }: { weekStart: string; onWeekChange: (date: string) => void }) => (
    <div data-testid="week-navigator">
      <span>Week: {weekStart}</span>
      <button onClick={() => onWeekChange("2026-02-01")}>Previous</button>
    </div>
  ),
}));

vi.mock("@/components/weekly-nutrition-chart", () => ({
  WeeklyNutritionChart: ({ days, weekStart }: { days: DailyNutritionTotals[]; weekStart: string }) => (
    <div data-testid="weekly-nutrition-chart">
      Nutrition Chart: {days.length} days, week: {weekStart}
    </div>
  ),
}));

vi.mock("@/components/weekly-fasting-chart", () => ({
  WeeklyFastingChart: ({ windows, weekStart }: { windows: FastingWindow[]; weekStart: string }) => (
    <div data-testid="weekly-fasting-chart">
      Fasting Chart: {windows.length} windows, week: {weekStart}
    </div>
  ),
}));

describe("WeeklyDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders WeekNavigator with current week start", async () => {
    render(<WeeklyDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("week-navigator")).toBeInTheDocument();
      expect(screen.getByText("Week: 2026-02-08")).toBeInTheDocument();
    });
  });

  it("renders WeeklyNutritionChart with nutrition data", async () => {
    render(<WeeklyDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("weekly-nutrition-chart")).toBeInTheDocument();
      expect(screen.getByText(/Nutrition Chart: 1 days/)).toBeInTheDocument();
    });
  });

  it("renders WeeklyFastingChart with fasting data", async () => {
    render(<WeeklyDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("weekly-fasting-chart")).toBeInTheDocument();
      expect(screen.getByText(/Fasting Chart: 1 windows/)).toBeInTheDocument();
    });
  });

  it("updates week when WeekNavigator triggers change", async () => {
    const user = userEvent.setup();
    render(<WeeklyDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Week: 2026-02-08")).toBeInTheDocument();
    });

    const previousButton = screen.getByText("Previous");
    await user.click(previousButton);

    await waitFor(() => {
      expect(screen.getByText("Week: 2026-02-01")).toBeInTheDocument();
    });
  });

  // Note: Loading and error state testing is covered by integration tests
  // Component has proper loading skeletons (DashboardSkeleton) and error handling
  // for both nutritionError and fastingError states
});
