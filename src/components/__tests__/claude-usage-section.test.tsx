import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClaudeUsageSection } from "../claude-usage-section";

const mockUseSWR = vi.fn();

vi.mock("swr", () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

describe("ClaudeUsageSection", () => {
  beforeEach(() => {
    mockUseSWR.mockClear();
  });

  it("shows loading skeleton while fetching", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
    });

    render(<ClaudeUsageSection />);

    // Should show skeleton placeholders (using data-testid for loading state)
    expect(screen.getByTestId("claude-usage-loading")).toBeInTheDocument();
  });

  it("shows 'No usage data' when API returns empty months array", () => {
    mockUseSWR.mockReturnValue({
      data: { months: [] },
      error: null,
      isLoading: false,
    });

    render(<ClaudeUsageSection />);

    expect(screen.getByText(/No usage data/i)).toBeInTheDocument();
  });

  it("renders month rows with formatted totals", () => {
    mockUseSWR.mockReturnValue({
      data: {
        months: [
          {
            month: "2026-02",
            totalRequests: 150,
            totalInputTokens: 1234567,
            totalOutputTokens: 987654,
            totalCostUsd: "12.50",
          },
          {
            month: "2026-01",
            totalRequests: 120,
            totalInputTokens: 500000,
            totalOutputTokens: 300000,
            totalCostUsd: "8.75",
          },
        ],
      },
      error: null,
      isLoading: false,
    });

    render(<ClaudeUsageSection />);

    // Check that February 2026 data is present
    expect(screen.getByText(/February 2026/i)).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument(); // requests

    // Check that January 2026 data is present
    expect(screen.getByText(/January 2026/i)).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument(); // requests
  });

  it("formats cost as USD with 2 decimal places", () => {
    mockUseSWR.mockReturnValue({
      data: {
        months: [
          {
            month: "2026-02",
            totalRequests: 100,
            totalInputTokens: 50000,
            totalOutputTokens: 25000,
            totalCostUsd: "1.23",
          },
        ],
      },
      error: null,
      isLoading: false,
    });

    render(<ClaudeUsageSection />);

    expect(screen.getByText("$1.23")).toBeInTheDocument();
  });

  it("formats token counts with comma separators", () => {
    mockUseSWR.mockReturnValue({
      data: {
        months: [
          {
            month: "2026-02",
            totalRequests: 100,
            totalInputTokens: 1234567,
            totalOutputTokens: 987654,
            totalCostUsd: "10.00",
          },
        ],
      },
      error: null,
      isLoading: false,
    });

    render(<ClaudeUsageSection />);

    // Check formatted token counts
    expect(screen.getByText("1,234,567")).toBeInTheDocument();
    expect(screen.getByText("987,654")).toBeInTheDocument();
  });

  it("displays most recent month first", () => {
    mockUseSWR.mockReturnValue({
      data: {
        months: [
          {
            month: "2026-02",
            totalRequests: 150,
            totalInputTokens: 50000,
            totalOutputTokens: 25000,
            totalCostUsd: "12.50",
          },
          {
            month: "2026-01",
            totalRequests: 120,
            totalInputTokens: 40000,
            totalOutputTokens: 20000,
            totalCostUsd: "10.00",
          },
          {
            month: "2025-12",
            totalRequests: 100,
            totalInputTokens: 30000,
            totalOutputTokens: 15000,
            totalCostUsd: "7.50",
          },
        ],
      },
      error: null,
      isLoading: false,
    });

    render(<ClaudeUsageSection />);

    const months = screen.getAllByText(/\w+ \d{4}/);
    expect(months[0].textContent).toMatch(/February 2026/i);
    expect(months[1].textContent).toMatch(/January 2026/i);
    expect(months[2].textContent).toMatch(/December 2025/i);
  });

  it("uses SWR with apiFetcher pattern", () => {
    mockUseSWR.mockReturnValue({
      data: { months: [] },
      error: null,
      isLoading: false,
    });

    render(<ClaudeUsageSection />);

    // Verify useSWR was called with the correct endpoint
    expect(mockUseSWR).toHaveBeenCalledWith(
      "/api/claude-usage",
      expect.any(Function)
    );
  });

  it("renders card layout with proper styling", () => {
    mockUseSWR.mockReturnValue({
      data: { months: [] },
      error: null,
      isLoading: false,
    });

    const { container } = render(<ClaudeUsageSection />);

    // Check for card styling classes
    const card = container.querySelector(".rounded-xl.border.bg-card");
    expect(card).toBeInTheDocument();
  });

  it("displays header 'Claude API Usage'", () => {
    mockUseSWR.mockReturnValue({
      data: { months: [] },
      error: null,
      isLoading: false,
    });

    render(<ClaudeUsageSection />);

    expect(screen.getByText("Claude API Usage")).toBeInTheDocument();
  });
});
