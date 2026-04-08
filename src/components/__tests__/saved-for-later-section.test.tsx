import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SavedForLaterSection } from "../saved-for-later-section";
import type { SavedAnalysisListItem } from "@/types";

const mockItems: SavedAnalysisListItem[] = [
  {
    id: 1,
    description: "Grilled chicken with rice and vegetables",
    calories: 520,
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
  },
  {
    id: 2,
    description: "Chocolate cake slice with cream",
    calories: 380,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
  },
  {
    id: 3,
    description: "Apple",
    calories: 95,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
  },
];

describe("SavedForLaterSection", () => {
  it("renders nothing when items array is empty", () => {
    const { container } = render(
      <SavedForLaterSection items={[]} onItemClick={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders section header 'Saved for Later' when items exist", () => {
    render(<SavedForLaterSection items={mockItems} onItemClick={vi.fn()} />);
    expect(screen.getByText("Saved for Later")).toBeInTheDocument();
  });

  it("renders count badge with number of items", () => {
    render(<SavedForLaterSection items={mockItems} onItemClick={vi.fn()} />);
    expect(screen.getByTestId("saved-count-badge")).toHaveTextContent("3");
  });

  it("renders a card for each item showing food name", () => {
    render(<SavedForLaterSection items={mockItems} onItemClick={vi.fn()} />);
    expect(screen.getByText(/Grilled chicken with rice/)).toBeInTheDocument();
    expect(screen.getByText(/Chocolate cake slice/)).toBeInTheDocument();
    expect(screen.getByText(/Apple/)).toBeInTheDocument();
  });

  it("renders calories with 'cal' suffix for each item", () => {
    render(<SavedForLaterSection items={mockItems} onItemClick={vi.fn()} />);
    expect(screen.getByText("520 cal")).toBeInTheDocument();
    expect(screen.getByText("380 cal")).toBeInTheDocument();
    expect(screen.getByText("95 cal")).toBeInTheDocument();
  });

  it("clicking a card calls onItemClick with the item id", () => {
    const onItemClick = vi.fn();
    render(<SavedForLaterSection items={mockItems} onItemClick={onItemClick} />);

    const cards = screen.getAllByTestId("saved-item-card");
    fireEvent.click(cards[0]);
    expect(onItemClick).toHaveBeenCalledWith(1);

    fireEvent.click(cards[1]);
    expect(onItemClick).toHaveBeenCalledWith(2);
  });

  describe("relative time formatting", () => {
    it("shows 'just now' for items less than 1 minute old", () => {
      const items: SavedAnalysisListItem[] = [
        {
          id: 1,
          description: "Fresh item",
          calories: 100,
          createdAt: new Date(Date.now() - 30 * 1000).toISOString(), // 30 seconds ago
        },
      ];
      render(<SavedForLaterSection items={items} onItemClick={vi.fn()} />);
      expect(screen.getByText("just now")).toBeInTheDocument();
    });

    it("shows 'Xm ago' for items less than 1 hour old", () => {
      const items: SavedAnalysisListItem[] = [
        {
          id: 1,
          description: "Recent item",
          calories: 100,
          createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
        },
      ];
      render(<SavedForLaterSection items={items} onItemClick={vi.fn()} />);
      expect(screen.getByText("30m ago")).toBeInTheDocument();
    });

    it("shows 'Xh ago' for items less than 24 hours old", () => {
      const items: SavedAnalysisListItem[] = [
        {
          id: 1,
          description: "A few hours ago",
          calories: 200,
          createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
        },
      ];
      render(<SavedForLaterSection items={items} onItemClick={vi.fn()} />);
      expect(screen.getByText("3h ago")).toBeInTheDocument();
    });

    it("shows 'yesterday' for items 24+ hours old", () => {
      const items: SavedAnalysisListItem[] = [
        {
          id: 1,
          description: "Yesterday item",
          calories: 150,
          createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
        },
      ];
      render(<SavedForLaterSection items={items} onItemClick={vi.fn()} />);
      expect(screen.getByText("yesterday")).toBeInTheDocument();
    });

    it("shows 'X days ago' for items 48+ hours old", () => {
      const items: SavedAnalysisListItem[] = [
        {
          id: 1,
          description: "Old item",
          calories: 300,
          createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
        },
      ];
      render(<SavedForLaterSection items={items} onItemClick={vi.fn()} />);
      expect(screen.getByText("3 days ago")).toBeInTheDocument();
    });
  });
});
