import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FoodDetail } from "../food-detail";

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

beforeEach(() => {
  vi.clearAllMocks();
  mockMutate.mockResolvedValue(undefined);
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
