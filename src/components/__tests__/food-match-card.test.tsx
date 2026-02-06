import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FoodMatchCard } from "../food-match-card";
import type { FoodMatch } from "@/types";

const mockMatch: FoodMatch = {
  customFoodId: 42,
  foodName: "Tea with milk",
  calories: 50,
  proteinG: 2,
  carbsG: 5,
  fatG: 2,
  fitbitFoodId: 12345,
  matchRatio: 0.85,
  lastLoggedAt: new Date("2026-02-05T12:00:00Z"),
  amount: 1,
  unitId: 91, // cup
};

describe("FoodMatchCard", () => {
  it("renders food name, calories, and macros", () => {
    render(<FoodMatchCard match={mockMatch} onSelect={vi.fn()} />);

    expect(screen.getByText("Tea with milk")).toBeInTheDocument();
    expect(screen.getByText(/50/)).toBeInTheDocument(); // calories
    expect(screen.getByText(/2g protein/i)).toBeInTheDocument();
    expect(screen.getByText(/5g carbs/i)).toBeInTheDocument();
    expect(screen.getByText(/2g fat/i)).toBeInTheDocument();
  });

  it("renders amount with correct unit label", () => {
    render(<FoodMatchCard match={mockMatch} onSelect={vi.fn()} />);

    // unitId 91 = cup, amount 1 = "1 cup"
    expect(screen.getByText(/1 cup/)).toBeInTheDocument();
  });

  it("renders last logged date", () => {
    render(<FoodMatchCard match={mockMatch} onSelect={vi.fn()} />);

    expect(screen.getByText(/last logged/i)).toBeInTheDocument();
  });

  it("'Use this' button calls onSelect with the match data", () => {
    const onSelect = vi.fn();
    render(<FoodMatchCard match={mockMatch} onSelect={onSelect} />);

    const button = screen.getByRole("button", { name: /use this/i });
    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledWith(mockMatch);
  });

  it("'Use this' button has min 44px touch target", () => {
    render(<FoodMatchCard match={mockMatch} onSelect={vi.fn()} />);

    const button = screen.getByRole("button", { name: /use this/i });
    expect(button.className).toMatch(/min-h-\[44px\]/);
  });

  it("'Use this' button is disabled when disabled prop is true", () => {
    render(<FoodMatchCard match={mockMatch} onSelect={vi.fn()} disabled />);

    const button = screen.getByRole("button", { name: /use this/i });
    expect(button).toBeDisabled();
  });
});
