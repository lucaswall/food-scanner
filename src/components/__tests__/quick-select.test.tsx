import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QuickSelect } from "../quick-select";
import type { CommonFood, FoodLogResponse } from "@/types";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock pending-submission
vi.mock("@/lib/pending-submission", () => ({
  savePendingSubmission: vi.fn(),
  getPendingSubmission: vi.fn().mockReturnValue(null),
  clearPendingSubmission: vi.fn(),
}));

// Mock food-log-confirmation
vi.mock("../food-log-confirmation", () => ({
  FoodLogConfirmation: ({
    response,
    foodName,
    onReset,
  }: {
    response: FoodLogResponse | null;
    foodName: string;
    onReset: () => void;
  }) =>
    response ? (
      <div data-testid="food-log-confirmation">
        <span>Successfully logged {foodName}</span>
        <button onClick={onReset}>Log Another</button>
      </div>
    ) : null,
}));

// Mock meal-type-selector
vi.mock("../meal-type-selector", () => ({
  MealTypeSelector: ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (id: number) => void;
  }) => (
    <div data-testid="meal-type-selector">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value="1">Breakfast</option>
        <option value="3">Lunch</option>
        <option value="5">Dinner</option>
      </select>
    </div>
  ),
}));

const mockFoods: CommonFood[] = [
  {
    customFoodId: 1,
    foodName: "Empanada de carne",
    amount: 150,
    unitId: 147,
    calories: 320,
    proteinG: 12,
    carbsG: 28,
    fatG: 18,
    fiberG: 2,
    sodiumMg: 450,
    fitbitFoodId: 111,
    mealTypeId: 3,
  },
  {
    customFoodId: 2,
    foodName: "Cafe con leche",
    amount: 250,
    unitId: 209,
    calories: 120,
    proteinG: 6,
    carbsG: 10,
    fatG: 5,
    fiberG: 0,
    sodiumMg: 80,
    fitbitFoodId: 222,
    mealTypeId: 1,
  },
];

const mockLogResponse: FoodLogResponse = {
  success: true,
  fitbitFoodId: 111,
  fitbitLogId: 67890,
  reusedFood: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QuickSelect", () => {
  it("renders loading state initially", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<QuickSelect />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders food cards when foods are returned", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
    });

    render(<QuickSelect />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
    });
  });

  it("each card shows food name, amount+unit, calories", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
    });

    render(<QuickSelect />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
      expect(screen.getByText("150g")).toBeInTheDocument();
      expect(screen.getByText(/320/)).toBeInTheDocument();
    });
  });

  it("renders empty state with Take Photo button when 0 results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: [] } }),
    });

    render(<QuickSelect />);

    await waitFor(() => {
      expect(screen.getByText(/no recent foods/i)).toBeInTheDocument();
    });

    const takePhotoLinks = screen.getAllByRole("link", { name: /take photo/i });
    expect(takePhotoLinks.length).toBeGreaterThan(0);
    expect(takePhotoLinks[0]).toHaveAttribute("href", "/app/analyze");
  });

  it("tapping a food card shows confirmation with Log to Fitbit button", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
    });

    render(<QuickSelect />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
      expect(screen.getByText("Nutrition Facts")).toBeInTheDocument();
    });
  });

  it("logging calls /api/log-food with reuseCustomFoodId", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
      });

    render(<QuickSelect />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/log-food",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"reuseCustomFoodId":1'),
        })
      );
    });
  });

  it("after successful log, shows success screen", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
      });

    render(<QuickSelect />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
    });
  });

  it("Log Another returns to food list and refetches", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockLogResponse }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
      });

    render(<QuickSelect />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(screen.getByTestId("food-log-confirmation")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /log another/i }));

    await waitFor(() => {
      // Should refetch foods
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });
  });

  it("Take Photo buttons link to /app/analyze", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
    });

    render(<QuickSelect />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    const takePhotoLinks = screen.getAllByRole("link", { name: /take photo/i });
    expect(takePhotoLinks.length).toBeGreaterThanOrEqual(1);
    takePhotoLinks.forEach((link) => {
      expect(link).toHaveAttribute("href", "/app/analyze");
    });
  });

  it("has back button from detail view to food list", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { foods: mockFoods } }),
    });

    render(<QuickSelect />);

    await waitFor(() => {
      expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Empanada de carne"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    await waitFor(() => {
      // Should be back on food list
      expect(screen.getByText("Cafe con leche")).toBeInTheDocument();
    });
  });
});
