import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { FastingCard } from "../fasting-card";
import type { FastingResponse } from "@/types";

// Mock useSWR
const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => mockUseSWR(key),
}));

vi.mock("@/lib/swr", () => ({
  apiFetcher: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("FastingCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("shows loading skeleton when data is loading", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
    });

    render(<FastingCard date="2026-02-12" />);

    const skeleton = screen.getByTestId("fasting-skeleton");
    expect(skeleton).toBeInTheDocument();
  });

  it("shows actionable message when window is null", () => {
    const response: FastingResponse = {
      window: null,
      live: null,
    };

    mockUseSWR.mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
    });

    render(<FastingCard date="2026-02-12" />);

    expect(screen.getByText(/log.*meal.*start tracking/i)).toBeInTheDocument();
  });

  it("displays completed fasting window with duration and time range", () => {
    const response: FastingResponse = {
      window: {
        date: "2026-02-12",
        lastMealTime: "21:00:00",
        firstMealTime: "09:00:00",
        durationMinutes: 720,
      },
      live: null,
    };

    mockUseSWR.mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
    });

    render(<FastingCard date="2026-02-12" />);

    // Check duration display (720 minutes = 12 hours)
    expect(screen.getByText("12h 0m")).toBeInTheDocument();

    // Check time range display
    expect(screen.getByText(/9:00 PM.*9:00 AM/)).toBeInTheDocument();
  });

  it("formats duration correctly for hours and minutes", () => {
    const response: FastingResponse = {
      window: {
        date: "2026-02-12",
        lastMealTime: "20:30:00",
        firstMealTime: "10:15:00",
        durationMinutes: 825, // 13h 45m
      },
      live: null,
    };

    mockUseSWR.mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
    });

    render(<FastingCard date="2026-02-12" />);

    expect(screen.getByText("13h 45m")).toBeInTheDocument();
  });

  it("formats duration correctly for whole hours", () => {
    const response: FastingResponse = {
      window: {
        date: "2026-02-12",
        lastMealTime: "20:00:00",
        firstMealTime: "08:00:00",
        durationMinutes: 720, // 12h 0m
      },
      live: null,
    };

    mockUseSWR.mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
    });

    render(<FastingCard date="2026-02-12" />);

    expect(screen.getByText("12h 0m")).toBeInTheDocument();
  });

  it("displays live mode with pulsing indicator", () => {
    const response: FastingResponse = {
      window: {
        date: "2026-02-12",
        lastMealTime: "20:00:00",
        firstMealTime: null,
        durationMinutes: null,
      },
      live: {
        lastMealTime: "20:00:00",
        startDate: "2026-02-12",
      },
    };

    mockUseSWR.mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
    });

    // Mock Date.now() to return a known time for testing
    // 2026-02-12 23:00:00 local time (3 hours after last meal at 20:00:00)
    const mockNow = new Date("2026-02-12T23:00:00").getTime();
    vi.setSystemTime(mockNow);

    render(<FastingCard date="2026-02-12" />);

    // Check for pulsing dot indicator
    const pulsingDot = screen.getByTestId("fasting-live-dot");
    expect(pulsingDot).toBeInTheDocument();
    expect(pulsingDot).toHaveClass("animate-pulse");

    // Check for live duration display (3 hours = 180 minutes)
    expect(screen.getByText(/3h 0m/)).toBeInTheDocument();
  });

  it("updates live counter every minute", async () => {
    const response: FastingResponse = {
      window: {
        date: "2026-02-12",
        lastMealTime: "20:00:00",
        firstMealTime: null,
        durationMinutes: null,
      },
      live: {
        lastMealTime: "20:00:00",
        startDate: "2026-02-12",
      },
    };

    mockUseSWR.mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
    });

    // Start at 2026-02-12 23:00:00 local time (3 hours after last meal)
    const mockNow = new Date("2026-02-12T23:00:00").getTime();
    vi.setSystemTime(mockNow);

    render(<FastingCard date="2026-02-12" />);

    // Initial state: 3h 0m
    expect(screen.getByText(/3h 0m/)).toBeInTheDocument();

    // Advance time by 1 minute
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // Check the updated state
    expect(screen.getByText(/3h 1m/)).toBeInTheDocument();
  });

  it("cleans up timer on unmount", () => {
    const response: FastingResponse = {
      window: {
        date: "2026-02-12",
        lastMealTime: "20:00:00",
        firstMealTime: null,
        durationMinutes: null,
      },
      live: {
        lastMealTime: "20:00:00",
        startDate: "2026-02-12",
      },
    };

    mockUseSWR.mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
    });

    const { unmount } = render(<FastingCard date="2026-02-12" />);

    // Get the number of timers before unmount
    const timerCountBefore = vi.getTimerCount();
    expect(timerCountBefore).toBeGreaterThan(0);

    // Unmount the component
    unmount();

    // Timer should be cleared
    const timerCountAfter = vi.getTimerCount();
    expect(timerCountAfter).toBeLessThan(timerCountBefore);
  });

  it("displays error message when fetch fails", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("Failed to fetch"),
      isLoading: false,
    });

    render(<FastingCard date="2026-02-12" />);

    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });

  it("formats 12-hour time correctly with AM/PM", () => {
    const response: FastingResponse = {
      window: {
        date: "2026-02-12",
        lastMealTime: "13:30:00", // 1:30 PM
        firstMealTime: "07:15:00", // 7:15 AM
        durationMinutes: 1065,
      },
      live: null,
    };

    mockUseSWR.mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
    });

    render(<FastingCard date="2026-02-12" />);

    // Should display "1:30 PM → 7:15 AM"
    expect(screen.getByText(/1:30 PM.*7:15 AM/)).toBeInTheDocument();
  });

  it("handles midnight times correctly", () => {
    const response: FastingResponse = {
      window: {
        date: "2026-02-12",
        lastMealTime: "00:00:00", // 12:00 AM
        firstMealTime: "12:00:00", // 12:00 PM
        durationMinutes: 720,
      },
      live: null,
    };

    mockUseSWR.mockReturnValue({
      data: response,
      error: undefined,
      isLoading: false,
    });

    render(<FastingCard date="2026-02-12" />);

    expect(screen.getByText(/12:00 AM.*12:00 PM/)).toBeInTheDocument();
  });
});
