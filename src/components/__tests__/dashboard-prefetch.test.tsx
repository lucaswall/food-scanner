import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Mock SWR's preload
const mockPreload = vi.fn();
vi.mock("swr", () => ({
  preload: (...args: unknown[]) => mockPreload(...args),
}));

// Mock the apiFetcher
const mockApiFetcher = vi.fn();
vi.mock("@/lib/swr", () => ({
  apiFetcher: (...args: unknown[]) => mockApiFetcher(...args),
}));

import { DashboardPrefetch } from "../dashboard-prefetch";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DashboardPrefetch", () => {
  it("calls preload for /api/common-foods on mount", () => {
    render(<DashboardPrefetch />);
    expect(mockPreload).toHaveBeenCalledWith("/api/common-foods", expect.any(Function));
  });

  it("calls preload for /api/food-history?limit=20 on mount", () => {
    render(<DashboardPrefetch />);
    expect(mockPreload).toHaveBeenCalledWith("/api/food-history?limit=20", expect.any(Function));
  });

  it("renders nothing", () => {
    const { container } = render(<DashboardPrefetch />);
    expect(container.innerHTML).toBe("");
  });
});
