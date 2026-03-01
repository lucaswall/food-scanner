import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FoodLogHistoryEntry } from "@/types";

// Mock NutritionFactsCard
vi.mock("@/components/nutrition-facts-card", () => ({
  NutritionFactsCard: ({ foodName }: { foodName: string }) => (
    <div data-testid="nutrition-facts-card">{foodName}</div>
  ),
}));

// Mock Dialog components
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children, onOpenChange }: { open: boolean; children: React.ReactNode; onOpenChange?: (open: boolean) => void }) =>
    open ? <div data-testid="dialog" onClick={() => onOpenChange?.(false)}>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import { FoodEntryDetailSheet } from "@/components/food-entry-detail-sheet";

const baseEntry: FoodLogHistoryEntry = {
  id: 1,
  customFoodId: 10,
  foodName: "Test Food",
  calories: 300,
  proteinG: 20,
  carbsG: 30,
  fatG: 10,
  fiberG: 5,
  sodiumMg: 200,
  amount: 1,
  unitId: 304,
  mealTypeId: 1,
  date: "2026-03-01",
  time: "08:00:00",
  fitbitLogId: null,
  isFavorite: false,
};

const defaultProps = {
  entry: baseEntry,
  open: true,
  onOpenChange: vi.fn(),
  onToggleFavorite: vi.fn(),
  localFavorites: new Map<number, boolean>(),
  onShare: vi.fn(),
  isSharing: false,
  shareCopied: false,
  shareError: null,
};

describe("FoodEntryDetailSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders NutritionFactsCard with correct food name when entry is provided", () => {
    render(<FoodEntryDetailSheet {...defaultProps} />);
    expect(screen.getByTestId("nutrition-facts-card")).toBeInTheDocument();
    expect(screen.getByTestId("nutrition-facts-card")).toHaveTextContent("Test Food");
  });

  it("does not render anything when entry is null", () => {
    render(<FoodEntryDetailSheet {...defaultProps} entry={null} />);
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  it("shows favorite toggle button with correct aria-pressed when not favorite", () => {
    render(<FoodEntryDetailSheet {...defaultProps} />);
    const favoriteBtn = screen.getByRole("button", { name: /toggle favorite/i });
    expect(favoriteBtn).toBeInTheDocument();
    expect(favoriteBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("shows favorite toggle button with aria-pressed=true when favorite", () => {
    const localFavorites = new Map<number, boolean>([[10, true]]);
    render(<FoodEntryDetailSheet {...defaultProps} localFavorites={localFavorites} />);
    const favoriteBtn = screen.getByRole("button", { name: /toggle favorite/i });
    expect(favoriteBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("shows share button", () => {
    render(<FoodEntryDetailSheet {...defaultProps} />);
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });

  it("shows 'View Full Details' link pointing to /app/food-detail/{id}", () => {
    render(<FoodEntryDetailSheet {...defaultProps} />);
    const link = screen.getByRole("link", { name: /view full details/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/app/food-detail/1");
  });

  it("calls onToggleFavorite when favorite button clicked", () => {
    render(<FoodEntryDetailSheet {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /toggle favorite/i }));
    expect(defaultProps.onToggleFavorite).toHaveBeenCalledWith(baseEntry);
  });

  it("calls onShare when share button clicked", () => {
    render(<FoodEntryDetailSheet {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(defaultProps.onShare).toHaveBeenCalledWith(baseEntry);
  });

  it("shows 'Link copied!' when shareCopied is true", () => {
    render(<FoodEntryDetailSheet {...defaultProps} shareCopied={true} />);
    expect(screen.getByText("Link copied!")).toBeInTheDocument();
  });

  it("shows shareError when provided", () => {
    render(<FoodEntryDetailSheet {...defaultProps} shareError="Failed to share." />);
    expect(screen.getByText("Failed to share.")).toBeInTheDocument();
  });
});
