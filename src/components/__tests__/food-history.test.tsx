import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import { FoodHistory } from "../food-history";
import type { FoodLogHistoryEntry } from "@/types";

// Mock ResizeObserver for Radix UI Dialog
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

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

function renderFoodHistory() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <FoodHistory />
    </SWRConfig>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FoodHistory", () => {
  it("renders loading state", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderFoodHistory();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders entries grouped by date", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    renderFoodHistory();

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

    renderFoodHistory();

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

    renderFoodHistory();

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

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText(/no food log entries/i)).toBeInTheDocument();
    });
  });

  it("empty state includes guidance text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: [] } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText(/no food log entries/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/take a photo or use quick select/i)).toBeInTheDocument();
  });

  it("delete button opens AlertDialog and confirm deletes entry", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Click delete button — should open AlertDialog, not immediately delete
    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    // AlertDialog should be visible
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(screen.getByText(/delete this entry/i)).toBeInTheDocument();
    });

    // Click confirm button in the AlertDialog
    const confirmButton = screen.getByRole("button", { name: /confirm/i });
    fireEvent.click(confirmButton);

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

  it("delete AlertDialog cancel button dismisses without deleting", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Click delete button to open AlertDialog
    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    // Click cancel
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    // AlertDialog should be dismissed, entry still present, no DELETE call
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    // Only the initial fetch was called, no DELETE
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("delete handles errors gracefully with role=alert", async () => {
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

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Open AlertDialog and confirm
    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    const confirmButton = screen.getByRole("button", { name: /confirm/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      // Entry should still be visible
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      // Error message shown with role="alert"
      const errorContainer = screen.getByRole("alert");
      expect(errorContainer).toHaveTextContent(/failed to delete/i);
    });
  });

  it("formatDateHeader shows Today/Yesterday using local date, not UTC", async () => {
    // Simulate a scenario where UTC date differs from local date.
    // We mock Date so that:
    // - Local methods (getFullYear/getMonth/getDate) return Feb 6
    // - toISOString() returns "2026-02-07T..." (as if UTC is next day)
    // This happens in practice near midnight in western timezones (e.g., UTC-3).
    const RealDate = globalThis.Date;
    const mockNow = new RealDate(2026, 1, 6, 23, 30, 0); // Feb 6 23:30 local

    class MockDate extends RealDate {
      constructor(...args: Parameters<typeof RealDate>) {
        if (args.length === 0) {
          super(mockNow.getTime());
        } else {
          super(...args);
        }
      }

      toISOString(): string {
        // Simulate UTC being 3 hours ahead (next day)
        const shifted = new RealDate(this.getTime() + 3 * 60 * 60 * 1000);
        return RealDate.prototype.toISOString.call(shifted);
      }
    }
    MockDate.now = () => mockNow.getTime();

    globalThis.Date = MockDate as typeof Date;

    const entriesForToday: FoodLogHistoryEntry[] = [
      {
        id: 1,
        foodName: "Late night snack",
        calories: 200,
        proteinG: 5,
        carbsG: 30,
        fatG: 8,
        fiberG: 1,
        sodiumMg: 100,
        amount: 100,
        unitId: 147,
        mealTypeId: 5,
        date: "2026-02-06",
        time: "23:00:00",
        fitbitLogId: 999,
      },
      {
        id: 2,
        foodName: "Yesterday dinner",
        calories: 500,
        proteinG: 25,
        carbsG: 40,
        fatG: 20,
        fiberG: 3,
        sodiumMg: 600,
        amount: 300,
        unitId: 147,
        mealTypeId: 5,
        date: "2026-02-05",
        time: "20:00:00",
        fitbitLogId: 998,
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: entriesForToday } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Late night snack")).toBeInTheDocument();
    });

    // With the fix (local date methods), "2026-02-06" should show as "Today"
    // With the bug (toISOString), todayStr would be "2026-02-07", so it wouldn't match
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();

    globalThis.Date = RealDate;
  });

  it("Load more sends composite cursor params (lastDate, lastTime, lastId)", async () => {
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

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Food 1")).toBeInTheDocument();
    });

    const loadMoreButton = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(loadMoreButton);

    // Oldest entry is id=20, date=yesterday, time="12:00:00"
    await waitFor(() => {
      const url = mockFetch.mock.calls[1][0] as string;
      expect(url).toContain(`lastDate=${yesterday}`);
      expect(url).toContain("lastTime=12%3A00%3A00");
      expect(url).toContain("lastId=20");
      // Should NOT contain afterId
      expect(url).not.toContain("afterId");
    });
  });

  it("dialog has aria-describedby={undefined} to suppress Radix warning", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    const entryButton = screen.getByRole("button", { name: /empanada de carne, 320 calories/i });
    fireEvent.click(entryButton);

    await waitFor(() => {
      const dialogContent = screen.getByRole("dialog");
      expect(dialogContent).not.toHaveAttribute("aria-describedby");
    });
  });

  it("tapping an entry row opens a dialog with nutrition facts", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Click the entry row button (aria-label includes calories, not "Delete")
    const entryButton = screen.getByRole("button", { name: /empanada de carne, 320 calories/i });
    fireEvent.click(entryButton);

    await waitFor(() => {
      expect(screen.getByText("Nutrition Facts")).toBeInTheDocument();
      // Fiber and sodium should be visible in the dialog
      expect(screen.getByText("2g")).toBeInTheDocument();
      expect(screen.getByText("450mg")).toBeInTheDocument();
    });
  });

  it("dialog shows correct data for the clicked entry", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
    });

    // Click the second entry
    const entryButton = screen.getByRole("button", { name: /cafe con leche, 120 calories/i });
    fireEvent.click(entryButton);

    await waitFor(() => {
      expect(screen.getByText("Nutrition Facts")).toBeInTheDocument();
      // Cafe con leche specific values
      expect(screen.getByText("0g")).toBeInTheDocument(); // fiber
      expect(screen.getByText("80mg")).toBeInTheDocument(); // sodium
    });
  });

  it("clicking delete button does NOT open nutrition dialog", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Click the delete button — should open AlertDialog, not nutrition dialog
    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    // Nutrition dialog should NOT open
    await waitFor(() => {
      expect(screen.queryByText("Nutrition Facts")).not.toBeInTheDocument();
    });

    // But AlertDialog should be open — dismiss it
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);
  });

  it("dialog can be closed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Open dialog
    const entryButton = screen.getByRole("button", { name: /empanada de carne, 320 calories/i });
    fireEvent.click(entryButton);

    await waitFor(() => {
      expect(screen.getByText("Nutrition Facts")).toBeInTheDocument();
    });

    // Close dialog
    const closeButton = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText("Nutrition Facts")).not.toBeInTheDocument();
    });
  });

  it("entry detail dialog has bottom-sheet animation classes on mobile", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Open dialog
    const entryButton = screen.getByRole("button", { name: /empanada de carne, 320 calories/i });
    fireEvent.click(entryButton);

    await waitFor(() => {
      expect(screen.getByText("Nutrition Facts")).toBeInTheDocument();
    });

    // The DialogContent renders as role="dialog"
    const dialog = screen.getByRole("dialog");
    const classes = dialog.className;
    // Should have bottom-sheet animation class for mobile
    expect(classes).toContain("data-[state=open]:slide-in-from-bottom");
    expect(classes).toContain("data-[state=closed]:slide-out-to-bottom");
    // Should be positioned at bottom on mobile
    expect(dialog).toHaveClass("bottom-0");
    // Should have rounded top corners
    expect(dialog).toHaveClass("rounded-t-lg");
  });

  it("Load more omits lastTime when entry time is null", async () => {
    const entriesWithNullTime: FoodLogHistoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      foodName: `Food ${i + 1}`,
      calories: 100,
      proteinG: 5,
      carbsG: 10,
      fatG: 3,
      fiberG: 1,
      sodiumMg: 50,
      amount: 100,
      unitId: 147,
      mealTypeId: 3,
      date: today,
      time: null,
      fitbitLogId: 1000 + i,
    }));

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: entriesWithNullTime } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: [] } }),
      });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Food 1")).toBeInTheDocument();
    });

    const loadMoreButton = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(loadMoreButton);

    await waitFor(() => {
      const url = mockFetch.mock.calls[1][0] as string;
      expect(url).toContain(`lastDate=${today}`);
      expect(url).toContain("lastId=20");
      expect(url).not.toContain("lastTime");
    });
  });

  it("SWR revalidation after delete does not overwrite paginated entries", async () => {
    // Initial 20 entries so "Load More" button appears
    const initialEntries: FoodLogHistoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      foodName: `Initial ${i + 1}`,
      calories: 100,
      proteinG: 5,
      carbsG: 10,
      fatG: 3,
      fiberG: 1,
      sodiumMg: 50,
      amount: 100,
      unitId: 147,
      mealTypeId: 3,
      date: today,
      time: "12:00:00",
      fitbitLogId: 1000 + i,
    }));

    // Extra entries returned by "Load More"
    const paginatedEntries: FoodLogHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      id: 100 + i,
      foodName: `Paginated ${i + 1}`,
      calories: 200,
      proteinG: 10,
      carbsG: 20,
      fatG: 6,
      fiberG: 2,
      sodiumMg: 100,
      amount: 100,
      unitId: 147,
      mealTypeId: 3,
      date: yesterday,
      time: "10:00:00",
      fitbitLogId: 2000 + i,
    }));

    // SWR revalidation after mutate() returns first page only (without deleted entry)
    const revalidatedEntries = initialEntries.filter((e) => e.id !== 1);

    mockFetch
      // Call 1: SWR initial fetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: initialEntries } }),
      })
      // Call 2: "Load More" pagination
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: paginatedEntries } }),
      })
      // Call 3: DELETE API call
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
      // Call 4: SWR revalidation triggered by mutate()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: revalidatedEntries } }),
      });

    renderFoodHistory();

    // Wait for initial entries
    await waitFor(() => {
      expect(screen.getByText("Initial 1")).toBeInTheDocument();
    });

    // Click "Load More" to append paginated entries
    const loadMoreButton = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(loadMoreButton);

    // Wait for paginated entries to appear
    await waitFor(() => {
      expect(screen.getByText("Paginated 1")).toBeInTheDocument();
    });

    // Now delete an entry — click delete button, then confirm in AlertDialog
    const deleteButtons = screen.getAllByRole("button", { name: /delete initial 1/i });
    fireEvent.click(deleteButtons[0]);

    // Confirm in AlertDialog
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
    const confirmButton = screen.getByRole("button", { name: /confirm/i });
    fireEvent.click(confirmButton);

    // Wait for delete to complete and SWR revalidation to settle
    await waitFor(() => {
      // Deleted entry should be gone
      expect(screen.queryByText("Initial 1")).not.toBeInTheDocument();
    });

    // Wait for SWR revalidation to complete
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    // CRITICAL: Paginated entries should still be present after SWR revalidation
    expect(screen.getByText("Paginated 1")).toBeInTheDocument();
    expect(screen.getByText("Paginated 5")).toBeInTheDocument();
    // Other initial entries should also still be present
    expect(screen.getByText("Initial 2")).toBeInTheDocument();
  });

  it("date headers use h2 elements", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Date headers should be h2 (not h3) for proper heading hierarchy
    // mockEntries span two dates, so we should get exactly 2 h2 headings
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(2);
  });

  it("daily summary rounds calories to integer and macros to one decimal", async () => {
    const fractionalEntries: FoodLogHistoryEntry[] = [
      {
        id: 1,
        foodName: "Food A",
        calories: 123.4,
        proteinG: 10.15,
        carbsG: 20.27,
        fatG: 8.33,
        fiberG: 1,
        sodiumMg: 100,
        amount: 100,
        unitId: 147,
        mealTypeId: 3,
        date: today,
        time: "12:00:00",
        fitbitLogId: 111,
      },
      {
        id: 2,
        foodName: "Food B",
        calories: 200.8,
        proteinG: 15.89,
        carbsG: 30.56,
        fatG: 12.78,
        fiberG: 2,
        sodiumMg: 200,
        amount: 150,
        unitId: 147,
        mealTypeId: 1,
        date: today,
        time: "08:00:00",
        fitbitLogId: 222,
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: fractionalEntries } }),
    });

    renderFoodHistory();

    await waitFor(() => {
      expect(screen.getByText("Food A")).toBeInTheDocument();
    });

    // Total: 324.2 cal → 324 cal, P:26.04→26.0g, C:50.83→50.8g, F:21.11→21.1g
    expect(screen.getByText(/324 cal/)).toBeInTheDocument();
    expect(screen.getByText(/P:26\.0g/)).toBeInTheDocument();
    expect(screen.getByText(/C:50\.8g/)).toBeInTheDocument();
    expect(screen.getByText(/F:21\.1g/)).toBeInTheDocument();
  });

  it("shows cached data instantly on re-mount (SWR cache)", async () => {
    const cache = new Map();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { entries: mockEntries } }),
    });

    // First mount — loads data from fetch
    const { unmount } = render(
      <SWRConfig value={{ provider: () => cache }}>
        <FoodHistory />
      </SWRConfig>
    );

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    // Unmount
    unmount();
    cleanup();

    // Re-mount — should show data instantly from cache (no loading state)
    render(
      <SWRConfig value={{ provider: () => cache }}>
        <FoodHistory />
      </SWRConfig>
    );

    // Data should be visible immediately, no loading state
    expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });
});
