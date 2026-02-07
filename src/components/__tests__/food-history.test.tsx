import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FoodHistory } from "../food-history";
import type { FoodLogHistoryEntry } from "@/types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const today = "2026-02-06";
const yesterday = "2026-02-05";

const mockEntries: FoodLogHistoryEntry[] = [
  {
    id: 1,
    foodName: "Empanada de carne",
    calories: 320,
    proteinG: 12,
    carbsG: 28,
    fatG: 18,
    fiberG: 2,
    sodiumMg: 450,
    amount: 150,
    unitId: 147,
    mealTypeId: 3,
    date: today,
    time: "12:30:00",
    fitbitLogId: 111,
  },
  {
    id: 2,
    foodName: "Cafe con leche",
    calories: 120,
    proteinG: 6,
    carbsG: 10,
    fatG: 5,
    fiberG: 0,
    sodiumMg: 80,
    amount: 250,
    unitId: 209,
    mealTypeId: 1,
    date: today,
    time: "08:00:00",
    fitbitLogId: 222,
  },
  {
    id: 3,
    foodName: "Milanesa con pure",
    calories: 580,
    proteinG: 35,
    carbsG: 45,
    fatG: 22,
    fiberG: 3,
    sodiumMg: 700,
    amount: 300,
    unitId: 147,
    mealTypeId: 5,
    date: yesterday,
    time: "20:00:00",
    fitbitLogId: 333,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  // Mock window.confirm
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("FoodHistory", () => {
  it("renders loading state", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<FoodHistory />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders entries grouped by date", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    render(<FoodHistory />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
      expect(screen.getByText("Milanesa con pure")).toBeInTheDocument();
    });
  });

  it("each entry shows food name, calories, meal type", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    render(<FoodHistory />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      // Calories
      expect(screen.getByText(/320/)).toBeInTheDocument();
      // Meal type (part of combined text)
      expect(screen.getByText(/Lunch/)).toBeInTheDocument();
    });
  });

  it("shows daily summary with total calories", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    render(<FoodHistory />);

    await waitFor(() => {
      // Today's total: 320 + 120 = 440 cal
      expect(screen.getByText(/440/)).toBeInTheDocument();
    });
  });

  it("renders empty state when no entries", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: [] } }),
    });

    render(<FoodHistory />);

    await waitFor(() => {
      expect(screen.getByText(/no food log entries/i)).toBeInTheDocument();
    });
  });

  it("delete button calls DELETE /api/food-history/{id} and removes entry", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

    render(<FoodHistory />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/food-history/1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Empanada de carne")).not.toBeInTheDocument();
    });
  });

  it("delete handles errors gracefully", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: "FITBIT_API_ERROR", message: "Failed to delete" },
          }),
      });

    render(<FoodHistory />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      // Entry should still be visible
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      // Error message shown
      expect(screen.getByText(/failed to delete/i)).toBeInTheDocument();
    });
  });

  it("Load more triggers fetch with oldest date as cursor", async () => {
    // Need 20 entries to trigger hasMore=true
    const manyEntries: FoodLogHistoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      foodName: `Food ${i + 1}`,
      calories: 100 + i * 10,
      proteinG: 5,
      carbsG: 10,
      fatG: 3,
      fiberG: 1,
      sodiumMg: 50,
      amount: 100,
      unitId: 147,
      mealTypeId: 3,
      date: i < 10 ? today : yesterday,
      time: "12:00:00",
      fitbitLogId: 1000 + i,
    }));

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: manyEntries } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: [] } }),
      });

    render(<FoodHistory />);

    await waitFor(() => {
      expect(screen.getByText("Food 1")).toBeInTheDocument();
    });

    const loadMoreButton = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(loadMoreButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`endDate=${yesterday}`),
        expect.any(Object)
      );
    });
  });
});
