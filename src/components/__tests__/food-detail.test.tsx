import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { FoodDetail } from "../food-detail";
import type { FoodLogEntryDetail } from "@/types";

// Mock fetch for PATCH calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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
  customFoodId: 42,
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
  confidence: "high",
  isFavorite: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
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

  it("renders time in 24h format", () => {
    render(<FoodDetail entryId="1" />);
    // time: "12:30:00" should display as "12:30" (no AM/PM)
    expect(screen.getByText(/· 12:30 ·/)).toBeInTheDocument();
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

describe("FoodDetail share button", () => {
  beforeEach(() => {
    mockUseSWR.mockReturnValue({
      data: mockEntry,
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });
  });

  it("renders a share button", () => {
    render(<FoodDetail entryId="1" />);
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });

  it("calls POST /api/share with correct customFoodId on click", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { shareUrl: "http://localhost/app/log-shared/tok", shareToken: "tok" } }),
    });
    vi.stubGlobal("fetch", mockFetch);
    // No navigator.share — clipboard path
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });

    render(<FoodDetail entryId="1" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/share",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ customFoodId: mockEntry.customFoodId }),
        }),
      );
    });
    vi.unstubAllGlobals();
  });

  it("shows copied confirmation after sharing via clipboard", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { shareUrl: "http://localhost/app/log-shared/tok", shareToken: "tok" } }),
    });
    vi.stubGlobal("fetch", mockFetch);
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });

    render(<FoodDetail entryId="1" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => {
      expect(screen.getByText(/copied/i)).toBeInTheDocument();
    });
    vi.unstubAllGlobals();
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

describe("FoodDetail star (favorite) UI", () => {
  it("renders star button when data is loaded", () => {
    mockUseSWR.mockReturnValue({
      data: { ...mockEntry, isFavorite: false },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    render(<FoodDetail entryId="1" />);
    expect(screen.getByRole("button", { name: /favorite/i })).toBeInTheDocument();
  });

  it("renders filled star when isFavorite is true", () => {
    mockUseSWR.mockReturnValue({
      data: { ...mockEntry, isFavorite: true },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    render(<FoodDetail entryId="1" />);
    const starBtn = screen.getByRole("button", { name: /favorite/i });
    // The star icon should have fill="currentColor" when favorite
    const starSvg = starBtn.querySelector("svg");
    expect(starSvg).not.toBeNull();
    // When favorite, the icon has fill attribute
    expect(starBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("renders outline star when isFavorite is false", () => {
    mockUseSWR.mockReturnValue({
      data: { ...mockEntry, isFavorite: false },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    render(<FoodDetail entryId="1" />);
    const starBtn = screen.getByRole("button", { name: /favorite/i });
    expect(starBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("tapping star calls PATCH /api/custom-foods/[id]/favorite", async () => {
    mockUseSWR.mockReturnValue({
      data: { ...mockEntry, isFavorite: false, customFoodId: 42 },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { isFavorite: true } }),
    });

    render(<FoodDetail entryId="1" />);
    const starBtn = screen.getByRole("button", { name: /favorite/i });

    await act(async () => {
      fireEvent.click(starBtn);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/custom-foods/42/favorite",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("toggles star state optimistically on click", async () => {
    mockUseSWR.mockReturnValue({
      data: { ...mockEntry, isFavorite: false },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { isFavorite: true } }),
    });

    render(<FoodDetail entryId="1" />);
    const starBtn = screen.getByRole("button", { name: /favorite/i });
    expect(starBtn).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(starBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /favorite/i })).toHaveAttribute("aria-pressed", "true");
    });
  });
});
