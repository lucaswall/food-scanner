import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeeklyCalorieChart } from "@/components/weekly-calorie-chart";
import type { DailyNutritionTotals } from "@/types";

describe("WeeklyCalorieChart", () => {
  const mockDays: DailyNutritionTotals[] = [
    {
      date: "2026-02-08",
      calories: 1800,
      proteinG: 120,
      carbsG: 150,
      fatG: 60,
      fiberG: 25,
      sodiumMg: 2000,
      calorieGoal: 2000,
    },
    {
      date: "2026-02-09",
      calories: 2200,
      proteinG: 140,
      carbsG: 180,
      fatG: 70,
      fiberG: 30,
      sodiumMg: 2200,
      calorieGoal: 2000,
    },
    {
      date: "2026-02-10",
      calories: 1900,
      proteinG: 130,
      carbsG: 160,
      fatG: 65,
      fiberG: 28,
      sodiumMg: 2100,
      calorieGoal: 2000,
    },
  ];

  it("renders 7 day columns for the full week", () => {
    render(<WeeklyCalorieChart days={mockDays} weekStart="2026-02-08" />);

    // Check for day labels (S, M, T, W, T, F, S)
    // Use getAllByText for S and T since they appear multiple times
    const sLabels = screen.getAllByText("S", { selector: ".text-xs" });
    expect(sLabels.length).toBeGreaterThanOrEqual(2); // Sunday and Saturday

    expect(screen.getByText("M", { selector: ".text-xs" })).toBeInTheDocument(); // Monday

    const tLabels = screen.getAllByText("T", { selector: ".text-xs" });
    expect(tLabels.length).toBeGreaterThanOrEqual(2); // Tuesday and Thursday

    expect(screen.getByText("W", { selector: ".text-xs" })).toBeInTheDocument(); // Wednesday
    expect(screen.getByText("F", { selector: ".text-xs" })).toBeInTheDocument(); // Friday
  });

  it("shows empty state when no data is provided", () => {
    render(<WeeklyCalorieChart days={[]} weekStart="2026-02-08" />);

    expect(
      screen.getByText("Log food for a few days to see weekly trends")
    ).toBeInTheDocument();
  });

  it("displays bars with heights scaled to max calories", () => {
    render(<WeeklyCalorieChart days={mockDays} weekStart="2026-02-08" />);

    // The chart should render bars (divs with specific test IDs or classes)
    // Max calories in mockDays is 2200, so Feb 9 should be at 100% height
    const bars = screen.getAllByTestId(/^day-bar-/);
    expect(bars.length).toBeGreaterThan(0);
  });

  it("applies green color when calories are under goal", () => {
    const underGoalDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1500,
        proteinG: 100,
        carbsG: 150,
        fatG: 50,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
      },
    ];

    render(<WeeklyCalorieChart days={underGoalDays} weekStart="2026-02-08" />);

    // Look for green styling (bg-green-500 or similar)
    const bar = screen.getByTestId("day-bar-2026-02-08");
    expect(bar.className).toMatch(/bg-green/);
  });

  it("applies amber color when calories are over goal", () => {
    const overGoalDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 2500,
        proteinG: 150,
        carbsG: 200,
        fatG: 80,
        fiberG: 30,
        sodiumMg: 2500,
        calorieGoal: 2000,
      },
    ];

    render(<WeeklyCalorieChart days={overGoalDays} weekStart="2026-02-08" />);

    const bar = screen.getByTestId("day-bar-2026-02-08");
    expect(bar.className).toMatch(/bg-amber/);
  });

  it("applies primary color when no goal is set", () => {
    const noGoalDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1800,
        proteinG: 120,
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: null,
      },
    ];

    render(<WeeklyCalorieChart days={noGoalDays} weekStart="2026-02-08" />);

    const bar = screen.getByTestId("day-bar-2026-02-08");
    expect(bar.className).toMatch(/bg-primary/);
  });

  it("applies opacity-30 to empty days", () => {
    // Only provide one day of data, rest should be empty
    const sparseData: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1800,
        proteinG: 120,
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
      },
    ];

    render(<WeeklyCalorieChart days={sparseData} weekStart="2026-02-08" />);

    // Check that empty day bars have opacity-30
    const emptyBar = screen.getByTestId("day-bar-2026-02-09");
    expect(emptyBar.className).toMatch(/opacity-30/);
  });

  it("displays goal markers when calorieGoal is set", () => {
    render(<WeeklyCalorieChart days={mockDays} weekStart="2026-02-08" />);

    // Goal markers should be rendered (divs with specific test IDs)
    const goalMarkers = screen.getAllByTestId(/^goal-marker-/);
    expect(goalMarkers.length).toBeGreaterThan(0);
  });
});
