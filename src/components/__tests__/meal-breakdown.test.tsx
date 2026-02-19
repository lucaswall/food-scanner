import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MealBreakdown } from "../meal-breakdown";

// Mock ResizeObserver for any UI components that might need it
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
});

const mockMeals = [
  {
    mealTypeId: 1,
    subtotal: { calories: 450, proteinG: 30, carbsG: 80, fatG: 15, fiberG: 5, sodiumMg: 300, saturatedFatG: 2, transFatG: 0, sugarsG: 10, caloriesFromFat: 135 },
    entries: [
      {
        id: 1,
        customFoodId: 1,
        foodName: "Oatmeal",
        time: "08:00",
        calories: 300,
        proteinG: 10, carbsG: 50, fatG: 8, fiberG: 4, sodiumMg: 100, saturatedFatG: 1, transFatG: 0, sugarsG: 5, caloriesFromFat: 72,
      },
      {
        id: 2,
        customFoodId: 2,
        foodName: "Banana",
        time: "08:15",
        calories: 150,
        proteinG: 20, carbsG: 30, fatG: 7, fiberG: 1, sodiumMg: 200, saturatedFatG: 1, transFatG: 0, sugarsG: 5, caloriesFromFat: 63,
      },
    ],
  },
  {
    mealTypeId: 3,
    subtotal: { calories: 650, proteinG: 55, carbsG: 120, fatG: 35, fiberG: 5, sodiumMg: 500, saturatedFatG: 3, transFatG: 0, sugarsG: 10, caloriesFromFat: 315 },
    entries: [
      {
        id: 3,
        customFoodId: 3,
        foodName: "Chicken Salad",
        time: "12:30",
        calories: 650,
        proteinG: 55, carbsG: 120, fatG: 35, fiberG: 5, sodiumMg: 500, saturatedFatG: 3, transFatG: 0, sugarsG: 10, caloriesFromFat: 315,
      },
    ],
  },
];

describe("MealBreakdown", () => {
  it("renders a section for each meal type present in the data", () => {
    render(<MealBreakdown meals={mockMeals} />);

    expect(screen.getByText("Breakfast")).toBeInTheDocument();
    expect(screen.getByText("Lunch")).toBeInTheDocument();
  });

  it("section header shows meal name and calorie subtotal", () => {
    render(<MealBreakdown meals={mockMeals} />);

    expect(screen.getByText("Breakfast")).toBeInTheDocument();
    expect(screen.getByText("450 cal")).toBeInTheDocument();

    expect(screen.getByText("Lunch")).toBeInTheDocument();
    expect(screen.getByText("650 cal")).toBeInTheDocument();
  });

  it("sections are collapsed by default (entries not visible)", () => {
    render(<MealBreakdown meals={mockMeals} />);

    // Entries should not be visible initially
    expect(screen.queryByText("Oatmeal")).not.toBeInTheDocument();
    expect(screen.queryByText("Banana")).not.toBeInTheDocument();
    expect(screen.queryByText("Chicken Salad")).not.toBeInTheDocument();
  });

  it("clicking a section header expands it to show entries", async () => {
    const user = userEvent.setup();
    render(<MealBreakdown meals={mockMeals} />);

    // Initially entries not visible
    expect(screen.queryByText("Oatmeal")).not.toBeInTheDocument();

    // Click Breakfast header
    const breakfastHeader = screen.getByTestId("meal-header-1");
    await user.click(breakfastHeader);

    // Now Breakfast entries should be visible
    expect(screen.getByText("Oatmeal")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();

    // But Lunch entries should still be hidden
    expect(screen.queryByText("Chicken Salad")).not.toBeInTheDocument();
  });

  it("each entry shows food name, time, and calories", async () => {
    const user = userEvent.setup();
    render(<MealBreakdown meals={mockMeals} />);

    // Expand Breakfast
    await user.click(screen.getByTestId("meal-header-1"));

    expect(screen.getByText("Oatmeal")).toBeInTheDocument();
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("300 cal")).toBeInTheDocument();

    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.getByText("08:15")).toBeInTheDocument();
    expect(screen.getByText("150 cal")).toBeInTheDocument();
  });

  it("clicking header again collapses the section", async () => {
    const user = userEvent.setup();
    render(<MealBreakdown meals={mockMeals} />);

    const breakfastHeader = screen.getByTestId("meal-header-1");

    // Expand
    await user.click(breakfastHeader);
    expect(screen.getByText("Oatmeal")).toBeInTheDocument();

    // Collapse
    await user.click(breakfastHeader);
    expect(screen.queryByText("Oatmeal")).not.toBeInTheDocument();
  });

  it("no section rendered for meal types with no entries", () => {
    render(<MealBreakdown meals={[]} />);

    expect(screen.queryByText("Breakfast")).not.toBeInTheDocument();
    expect(screen.queryByText("Lunch")).not.toBeInTheDocument();
  });

  it("header button has aria-expanded=false by default and aria-expanded=true when expanded", async () => {
    const user = userEvent.setup();
    render(<MealBreakdown meals={mockMeals} />);

    const breakfastHeader = screen.getByTestId("meal-header-1");

    // Initially collapsed
    expect(breakfastHeader).toHaveAttribute("aria-expanded", "false");

    // After click, expanded
    await user.click(breakfastHeader);
    expect(breakfastHeader).toHaveAttribute("aria-expanded", "true");

    // After second click, collapsed again
    await user.click(breakfastHeader);
    expect(breakfastHeader).toHaveAttribute("aria-expanded", "false");
  });

  it("headers have touch-friendly height (min 44px)", () => {
    render(<MealBreakdown meals={mockMeals} />);

    const breakfastHeader = screen.getByTestId("meal-header-1");
    expect(breakfastHeader).toHaveClass("min-h-[44px]");
  });

  it("renders meals in logical order", () => {
    const entry = (id: number, name: string, time: string, cal: number) => ({
      id, customFoodId: id, foodName: name, time, calories: cal,
      proteinG: 10, carbsG: 20, fatG: 5, fiberG: 2, sodiumMg: 100,
      saturatedFatG: 1, transFatG: 0, sugarsG: 3, caloriesFromFat: 45,
    });
    const sub = (cal: number) => ({
      calories: cal, proteinG: 10, carbsG: 20, fatG: 5, fiberG: 2, sodiumMg: 100,
      saturatedFatG: 1, transFatG: 0, sugarsG: 3, caloriesFromFat: 45,
    });
    const unorderedMeals = [
      { mealTypeId: 5, subtotal: sub(700), entries: [entry(1, "Pasta", "19:00", 700)] },
      { mealTypeId: 1, subtotal: sub(400), entries: [entry(2, "Eggs", "08:00", 400)] },
      { mealTypeId: 3, subtotal: sub(500), entries: [entry(3, "Salad", "12:00", 500)] },
    ];

    render(<MealBreakdown meals={unorderedMeals} />);

    const headers = screen.getAllByTestId(/meal-header-/);

    // Should be sorted: Breakfast (1), Lunch (3), Dinner (5)
    expect(headers[0]).toHaveAttribute("data-testid", "meal-header-1");
    expect(headers[1]).toHaveAttribute("data-testid", "meal-header-3");
    expect(headers[2]).toHaveAttribute("data-testid", "meal-header-5");
  });
});
