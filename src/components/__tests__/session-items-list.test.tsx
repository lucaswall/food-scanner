import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionItemsList } from "../session-items-list";
import type { FoodAnalysis } from "@/types";

const makeFoodAnalysis = (overrides: Partial<FoodAnalysis> = {}): FoodAnalysis => ({
  food_name: "Grilled Chicken",
  amount: 200,
  unit_id: 147,
  calories: 330,
  protein_g: 62,
  carbs_g: 0,
  fat_g: 7,
  saturated_fat_g: 2,
  trans_fat_g: 0,
  fiber_g: 0,
  sodium_mg: 150,
  sugars_g: 0,
  calories_from_fat: null,
  confidence: "high",
  notes: "Grilled, skinless",
  description: "Grilled chicken breast",
  keywords: ["chicken", "protein"],
  time: "21:10",
  mealTypeId: 5,
  date: "2026-04-09",
  ...overrides,
});

const mockItems: FoodAnalysis[] = [
  makeFoodAnalysis({
    food_name: "Pasta Carbonara",
    calories: 620,
    protein_g: 45,
    carbs_g: 30,
    fat_g: 28,
    confidence: "high",
    time: "12:30",
    mealTypeId: 3,
  }),
  makeFoodAnalysis({
    food_name: "Caesar Salad",
    calories: 280,
    protein_g: 12,
    carbs_g: 15,
    fat_g: 20,
    confidence: "medium",
    time: "12:35",
    mealTypeId: 3,
  }),
  makeFoodAnalysis({
    food_name: "Mystery Stew",
    calories: 400,
    protein_g: 25,
    carbs_g: 35,
    fat_g: 18,
    confidence: "low",
    time: null,
    mealTypeId: null,
  }),
];

describe("SessionItemsList", () => {
  it("renders empty state message when items array is empty", () => {
    render(<SessionItemsList items={[]} />);
    expect(screen.getByTestId("session-items-empty")).toBeInTheDocument();
  });

  it("renders all items with food name and calories", () => {
    render(<SessionItemsList items={mockItems} />);
    expect(screen.getByText("Pasta Carbonara")).toBeInTheDocument();
    expect(screen.getByText("Caesar Salad")).toBeInTheDocument();
    expect(screen.getByText("Mystery Stew")).toBeInTheDocument();
  });

  it("renders macro summary in compact format", () => {
    render(<SessionItemsList items={[mockItems[0]]} />);
    // "620 cal · 45p · 30c · 28f"
    expect(screen.getByText(/620 cal/)).toBeInTheDocument();
    expect(screen.getByText(/45p/)).toBeInTheDocument();
    expect(screen.getByText(/30c/)).toBeInTheDocument();
    expect(screen.getByText(/28f/)).toBeInTheDocument();
  });

  it("renders time label when time is set", () => {
    render(<SessionItemsList items={[mockItems[0]]} />);
    // time "12:30" should be formatted to "12:30 PM" (or locale-based)
    expect(screen.getByTestId("item-time-0")).toBeInTheDocument();
  });

  it("renders meal type label when mealTypeId is set", () => {
    render(<SessionItemsList items={[mockItems[0]]} />);
    expect(screen.getByText(/Lunch/)).toBeInTheDocument();
  });

  it("shows confidence badge with correct color for high confidence", () => {
    render(<SessionItemsList items={[mockItems[0]]} />);
    const badge = screen.getByTestId("confidence-badge-0");
    expect(badge).toHaveClass("bg-success");
  });

  it("shows confidence badge with correct color for medium confidence", () => {
    render(<SessionItemsList items={[mockItems[1]]} />);
    const badge = screen.getByTestId("confidence-badge-0");
    expect(badge).toHaveClass("bg-warning");
  });

  it("shows confidence badge with correct color for low confidence", () => {
    render(<SessionItemsList items={[mockItems[2]]} />);
    const badge = screen.getByTestId("confidence-badge-0");
    expect(badge).toHaveClass("bg-orange-400");
  });

  it("does not render remove button when onRemoveItem is not provided", () => {
    render(<SessionItemsList items={mockItems} />);
    expect(screen.queryByTestId("remove-item-0")).not.toBeInTheDocument();
  });

  it("renders remove button for each item when onRemoveItem is provided", () => {
    render(<SessionItemsList items={mockItems} onRemoveItem={vi.fn()} />);
    expect(screen.getByTestId("remove-item-0")).toBeInTheDocument();
    expect(screen.getByTestId("remove-item-1")).toBeInTheDocument();
    expect(screen.getByTestId("remove-item-2")).toBeInTheDocument();
  });

  it("remove button calls onRemoveItem with correct index", () => {
    const onRemoveItem = vi.fn();
    render(<SessionItemsList items={mockItems} onRemoveItem={onRemoveItem} />);
    fireEvent.click(screen.getByTestId("remove-item-1"));
    expect(onRemoveItem).toHaveBeenCalledWith(1);
  });

  it("remove button has 44x44px touch target", () => {
    render(<SessionItemsList items={[mockItems[0]]} onRemoveItem={vi.fn()} />);
    const btn = screen.getByTestId("remove-item-0");
    expect(btn).toHaveClass("min-h-[44px]");
    expect(btn).toHaveClass("min-w-[44px]");
  });
});
