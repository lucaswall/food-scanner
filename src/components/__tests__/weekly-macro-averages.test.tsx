import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeeklyMacroAverages } from "@/components/weekly-macro-averages";
import type { DailyNutritionTotals } from "@/types";

describe("WeeklyMacroAverages", () => {
  const mockDays: DailyNutritionTotals[] = [
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
    {
      date: "2026-02-09",
      calories: 2200,
      proteinG: 140,
      carbsG: 220,
      fatG: 70,
      fiberG: 30,
      sodiumMg: 2200,
      calorieGoal: 2000,
    },
    {
      date: "2026-02-10",
      calories: 1800,
      proteinG: 100,
      carbsG: 180,
      fatG: 50,
      fiberG: 20,
      sodiumMg: 1800,
      calorieGoal: 2000,
    },
  ];

  it("calculates and displays average macros", () => {
    render(<WeeklyMacroAverages days={mockDays} />);

    // Average protein: (120 + 140 + 100) / 3 = 120
    expect(screen.getByText("120g")).toBeInTheDocument();

    // Average carbs: (200 + 220 + 180) / 3 = 200
    expect(screen.getByText("200g")).toBeInTheDocument();

    // Average fat: (60 + 70 + 50) / 3 = 60
    expect(screen.getByText("60g")).toBeInTheDocument();
  });

  it("filters out zero-calorie days from the average", () => {
    const daysWithZero: DailyNutritionTotals[] = [
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
      {
        date: "2026-02-09",
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sodiumMg: 0,
        calorieGoal: 2000,
      },
      {
        date: "2026-02-10",
        calories: 1800,
        proteinG: 100,
        carbsG: 180,
        fatG: 50,
        fiberG: 20,
        sodiumMg: 1800,
        calorieGoal: 2000,
      },
    ];

    render(<WeeklyMacroAverages days={daysWithZero} />);

    // Average should only include days with calories > 0
    // Protein: (120 + 100) / 2 = 110
    expect(screen.getByText("110g")).toBeInTheDocument();

    // Carbs: (200 + 180) / 2 = 190
    expect(screen.getByText("190g")).toBeInTheDocument();

    // Fat: (60 + 50) / 2 = 55
    expect(screen.getByText("55g")).toBeInTheDocument();
  });

  it("shows 'No data' when all days have zero calories", () => {
    const emptyDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sodiumMg: 0,
        calorieGoal: 2000,
      },
    ];

    render(<WeeklyMacroAverages days={emptyDays} />);

    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("shows 'No data' when days array is empty", () => {
    render(<WeeklyMacroAverages days={[]} />);

    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("rounds averages to whole numbers", () => {
    const unevenDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 2000,
        proteinG: 125,
        carbsG: 205,
        fatG: 65,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
      },
      {
        date: "2026-02-09",
        calories: 2200,
        proteinG: 130,
        carbsG: 210,
        fatG: 60,
        fiberG: 30,
        sodiumMg: 2200,
        calorieGoal: 2000,
      },
    ];

    render(<WeeklyMacroAverages days={unevenDays} />);

    // Protein: (125 + 130) / 2 = 127.5 → 128
    expect(screen.getByText("128g")).toBeInTheDocument();

    // Carbs: (205 + 210) / 2 = 207.5 → 208
    expect(screen.getByText("208g")).toBeInTheDocument();

    // Fat: (65 + 60) / 2 = 62.5 → 63
    expect(screen.getByText("63g")).toBeInTheDocument();
  });

  it("displays macro bars similar to MacroBars component", () => {
    render(<WeeklyMacroAverages days={mockDays} />);

    // Check that the component renders bars for each macro
    expect(screen.getByText("Protein")).toBeInTheDocument();
    expect(screen.getByText("Carbs")).toBeInTheDocument();
    expect(screen.getByText("Fat")).toBeInTheDocument();
  });
});
