import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Mock SWR's preload
const mockPreload = vi.fn().mockResolvedValue(undefined);
vi.mock("swr", () => ({
  preload: (...args: unknown[]) => mockPreload(...args),
}));

// Mock the apiFetcher
const mockApiFetcher = vi.fn();
vi.mock("@/lib/swr", () => ({
  apiFetcher: (...args: unknown[]) => mockApiFetcher(...args),
}));

// Mock date-utils to return a fixed date for deterministic assertions
vi.mock("@/lib/date-utils", () => ({
  getTodayDate: vi.fn().mockReturnValue("2026-01-15"),
}));

import { DashboardPrefetch } from "../dashboard-prefetch";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DashboardPrefetch", () => {
  it("calls preload for /api/common-foods?tab=recent&limit=10 on mount", () => {
    render(<DashboardPrefetch />);
    expect(mockPreload).toHaveBeenCalledWith("/api/common-foods?tab=recent&limit=10", expect.any(Function));
  });

  it("calls preload for /api/food-history?limit=20 on mount", () => {
    render(<DashboardPrefetch />);
    expect(mockPreload).toHaveBeenCalledWith("/api/food-history?limit=20", expect.any(Function));
  });

  it("calls preload for /api/nutrition-summary with today's date on mount", () => {
    render(<DashboardPrefetch />);
    expect(mockPreload).toHaveBeenCalledWith("/api/nutrition-summary?date=2026-01-15", expect.any(Function));
  });

  it("calls preload for /api/nutrition-goals with today's date on mount", () => {
    render(<DashboardPrefetch />);
    expect(mockPreload).toHaveBeenCalledWith("/api/nutrition-goals?clientDate=2026-01-15", expect.any(Function));
  });

  it("calls preload for /api/earliest-entry on mount", () => {
    render(<DashboardPrefetch />);
    expect(mockPreload).toHaveBeenCalledWith("/api/earliest-entry", expect.any(Function));
  });

  it("does not preload /api/lumen-goals (removed)", () => {
    render(<DashboardPrefetch />);
    const lumenCall = mockPreload.mock.calls.find((call) =>
      typeof call[0] === "string" && call[0].includes("lumen-goals")
    );
    expect(lumenCall).toBeUndefined();
  });

  it("renders nothing", () => {
    const { container } = render(<DashboardPrefetch />);
    expect(container.innerHTML).toBe("");
  });
});
