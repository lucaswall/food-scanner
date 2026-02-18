import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FoodDetail } from "../food-detail";
import type { FoodLogEntryDetail } from "@/types";

// Mock next/navigation
const mockBack = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: mockBack }),
}));

// Mock @/lib/swr
vi.mock("@/lib/swr", () => ({
  apiFetcher: vi.fn(),
}));

// Hoist mocks so they're available in vi.mock factory
const { mockUseSWR, mockMutate } = vi.hoisted(() => ({
  mockUseSWR: vi.fn(),
  mockMutate: vi.fn(),
}));

vi.mock("swr", () => ({
  default: mockUseSWR,
}));

const mockEntry: FoodLogEntryDetail = {
  id: 1,
  foodName: "Empanada de carne",
  description: "Golden-brown baked empanada with beef filling",
  notes: "Standard Argentine beef empanada, baked style",
  calories: 320,
  proteinG: 12,
  carbsG: 28,
  fatG: 18,
  fiberG: 2,
  sodiumMg: 450,
  saturatedFatG: 5,
  transFatG: 0,
  sugarsG: 3,
  caloriesFromFat: 162,
  amount: 150,
  unitId: 147,
  mealTypeId: 3,
  date: "2026-02-15",
  time: "12:30:00",
  fitbitLogId: 12345,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMutate.mockResolvedValue(undefined);
});

describe("FoodDetail loading state", () => {
  beforeEach(() => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: mockMutate,
    });
  });

  it("renders loading indicator", () => {
    render(<FoodDetail entryId="1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

describe("FoodDetail successful render", () => {
  beforeEach(() => {
    mockUseSWR.mockReturnValue({
      data: mockEntry,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });
  });

  it("renders food name as heading", () => {
    render(<FoodDetail entryId="1" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Empanada de carne");
  });

  it("renders date and meal type", () => {
    render(<FoodDetail entryId="1" />);
    expect(screen.getByText(/Sunday, February 15, 2026/)).toBeInTheDocument();
  });

  it("renders description section", () => {
    render(<FoodDetail entryId="1" />);
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Golden-brown baked empanada with beef filling")).toBeInTheDocument();
  });

  it("renders notes section", () => {
    render(<FoodDetail entryId="1" />);
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Standard Argentine beef empanada, baked style")).toBeInTheDocument();
  });

  it("renders back button", () => {
    render(<FoodDetail entryId="1" />);
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("back button calls router.back()", () => {
    render(<FoodDetail entryId="1" />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe("FoodDetail !data guard", () => {
  it("returns null when data is undefined and not loading or errored", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    const { container } = render(<FoodDetail entryId="1" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("FoodDetail error state", () => {
  beforeEach(() => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("fetch failed"),
      isLoading: false,
      mutate: mockMutate,
    });
  });

  it("renders an error icon", () => {
    render(<FoodDetail entryId="1" />);
    expect(screen.getByTestId("error-icon")).toBeInTheDocument();
  });

  it("renders a retry button", () => {
    render(<FoodDetail entryId="1" />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("retry button calls mutate to refetch", () => {
    render(<FoodDetail entryId="1" />);
    const retryButton = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryButton);
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("renders a back button", () => {
    render(<FoodDetail entryId="1" />);
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("error content is inside a styled card container", () => {
    render(<FoodDetail entryId="1" />);
    const errorContainer = screen.getByTestId("error-container");
    expect(errorContainer).toHaveClass("bg-destructive/10");
  });
});
