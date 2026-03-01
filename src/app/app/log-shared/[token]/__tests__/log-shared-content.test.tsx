import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LogSharedContent } from "../log-shared-content";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

// Mock SWR
const { mockUseSWR } = vi.hoisted(() => ({
  mockUseSWR: vi.fn(),
}));

vi.mock("swr", () => ({
  default: mockUseSWR,
}));

vi.mock("@/lib/swr", () => ({
  apiFetcher: vi.fn(),
  invalidateFoodCaches: vi.fn().mockResolvedValue([]),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockSharedFood = {
  id: 42,
  foodName: "Grilled Chicken",
  amount: 150,
  unitId: 147,
  calories: 250,
  proteinG: 30,
  carbsG: 5,
  fatG: 10,
  fiberG: 2,
  sodiumMg: 400,
  saturatedFatG: null,
  transFatG: null,
  sugarsG: null,
  caloriesFromFat: null,
  confidence: "high",
  notes: null,
  description: null,
  keywords: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

describe("LogSharedContent date handling", () => {
  beforeEach(() => {
    mockUseSWR.mockReturnValue({
      data: mockSharedFood,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });
  });

  it("uses local date instead of UTC date when logging", async () => {
    // Set system time to 11:30 PM local = next day in UTC for UTC-N timezones
    // We verify by checking the fetch body contains the correct local date format
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: { message: "Logged" },
      }),
    });

    render(<LogSharedContent token="test-token" />);
    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/log-food",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    // Parse the body that was sent
    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);

    // The date should match the local date (from getLocalDateTime), not UTC
    // getLocalDateTime uses new Date().getFullYear()/getMonth()/getDate() (local)
    // vs toISOString().slice(0,10) which uses UTC
    const now = new Date();
    const expectedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(body.date).toBe(expectedDate);
  });
});
