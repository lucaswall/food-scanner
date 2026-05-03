import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FitbitHealthStatus } from "@/types";

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

function mockHealth(data: FitbitHealthStatus | undefined, opts?: { isLoading?: boolean; error?: Error }) {
  mockUseSWR.mockReturnValue({
    data,
    error: opts?.error,
    isLoading: opts?.isLoading ?? false,
  });
}

describe("FitbitStatusBanner", () => {
  it("renders nothing when status is healthy", () => {
    mockHealth({ status: "healthy" });

    const { container } = render(<FitbitStatusBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when loading", () => {
    mockHealth(undefined, { isLoading: true });

    const { container } = render(<FitbitStatusBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when there is an error", () => {
    mockHealth(undefined, { error: new Error("fetch failed") });

    const { container } = render(<FitbitStatusBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("shows 'Set up Fitbit' banner with link to /app/setup-fitbit when status is needs_setup", () => {
    mockHealth({ status: "needs_setup" });

    render(<FitbitStatusBanner />);
    expect(screen.getByText("Set up Fitbit to start logging food")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /set up fitbit/i });
    expect(link).toHaveAttribute("href", "/app/setup-fitbit");
  });

  it("shows 'Reconnect' banner when status is needs_reconnect", () => {
    mockHealth({ status: "needs_reconnect" });

    render(<FitbitStatusBanner />);
    expect(screen.getByText("Fitbit disconnected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeInTheDocument();
  });

  it("shows scope-mismatch banner with form POST to /api/auth/fitbit when status is scope_mismatch", () => {
    mockHealth({ status: "scope_mismatch", missingScopes: ["profile", "weight"] });

    render(<FitbitStatusBanner />);
    expect(screen.getByText("Reconnect Fitbit to grant new permissions")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /reconnect/i });
    expect(button).toBeInTheDocument();
    // The form should POST to /api/auth/fitbit
    const form = button.closest("form");
    expect(form).toHaveAttribute("action", "/api/auth/fitbit");
    expect(form).toHaveAttribute("method", "POST");
  });

  it("SWR fetches from /api/fitbit/health", () => {
    mockHealth({ status: "healthy" });
    render(<FitbitStatusBanner />);
    const swrCall = mockUseSWR.mock.calls[0];
    expect(swrCall[0]).toBe("/api/fitbit/health");
  });
});
