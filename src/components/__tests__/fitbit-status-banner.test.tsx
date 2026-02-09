import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

vi.mock("@/lib/swr", () => ({
  apiFetcher: vi.fn(),
}));

const { FitbitStatusBanner } = await import("@/components/fitbit-status-banner");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FitbitStatusBanner", () => {
  it("renders nothing when Fitbit is fully connected", () => {
    mockUseSWR.mockReturnValue({
      data: { fitbitConnected: true, hasFitbitCredentials: true, email: "test@example.com", expiresAt: Date.now() + 86400000 },
      error: undefined,
      isLoading: false,
    });

    const { container } = render(<FitbitStatusBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when loading", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
    });

    const { container } = render(<FitbitStatusBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when there is an error", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("fetch failed"),
      isLoading: false,
    });

    const { container } = render(<FitbitStatusBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("shows 'Set up Fitbit' banner with link to /app/setup-fitbit when no credentials", () => {
    mockUseSWR.mockReturnValue({
      data: { fitbitConnected: false, hasFitbitCredentials: false, email: "test@example.com", expiresAt: Date.now() + 86400000 },
      error: undefined,
      isLoading: false,
    });

    render(<FitbitStatusBanner />);
    expect(screen.getByText("Set up Fitbit to start logging food")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /set up fitbit/i });
    expect(link).toHaveAttribute("href", "/app/setup-fitbit");
  });

  it("shows warning banner in transitional state (connected but no credentials)", () => {
    mockUseSWR.mockReturnValue({
      data: { fitbitConnected: true, hasFitbitCredentials: false, email: "test@example.com", expiresAt: Date.now() + 86400000 },
      error: undefined,
      isLoading: false,
    });

    render(<FitbitStatusBanner />);
    expect(screen.getByText("Set up Fitbit credentials to keep logging food")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /set up now/i });
    expect(link).toHaveAttribute("href", "/app/setup-fitbit");
  });

  it("shows 'Reconnect' banner when credentials exist but not connected", () => {
    mockUseSWR.mockReturnValue({
      data: { fitbitConnected: false, hasFitbitCredentials: true, email: "test@example.com", expiresAt: Date.now() + 86400000 },
      error: undefined,
      isLoading: false,
    });

    render(<FitbitStatusBanner />);
    expect(screen.getByText("Fitbit disconnected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeInTheDocument();
  });
});
