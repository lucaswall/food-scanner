import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

vi.mock("@/lib/swr", () => ({
  apiFetcher: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const { HealthConnectGuard } = await import("@/components/health-connect-guard");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HealthConnectGuard", () => {
  it("renders children when healthConnected is true", () => {
    mockUseSWR.mockReturnValue({
      data: { healthConnected: true },
      isLoading: false,
    });

    render(
      <HealthConnectGuard>
        <div data-testid="child-content">Protected content</div>
      </HealthConnectGuard>,
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("renders children when healthConnected and healthScopeComplete are both true", () => {
    mockUseSWR.mockReturnValue({
      data: { healthConnected: true, healthScopeComplete: true },
      isLoading: false,
    });

    render(
      <HealthConnectGuard>
        <div data-testid="child-content">Protected content</div>
      </HealthConnectGuard>,
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("shows a reconnect prompt (not children) when connected but scopes are incomplete", () => {
    mockUseSWR.mockReturnValue({
      data: { healthConnected: true, healthScopeComplete: false },
      isLoading: false,
    });

    render(
      <HealthConnectGuard>
        <div data-testid="child-content">Protected content</div>
      </HealthConnectGuard>,
    );

    // Must NOT render the protected UI — those routes would 403 with HEALTH_SCOPE_MISSING.
    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
    // A reconnect affordance pointing at the OAuth re-init route.
    const link = screen.getByRole("link", { name: /reconnect google health/i });
    expect(link).toHaveAttribute("href", "/app/connect-health");
    expect(screen.getByText(/missing required permissions/i)).toBeInTheDocument();
  });

  it("shows connect prompt with Link to /app/connect-health when healthConnected is false", () => {
    mockUseSWR.mockReturnValue({
      data: { healthConnected: false },
      isLoading: false,
    });

    render(
      <HealthConnectGuard>
        <div data-testid="child-content">Protected content</div>
      </HealthConnectGuard>,
    );

    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /connect google health/i });
    expect(link).toHaveAttribute("href", "/app/connect-health");
  });

  it("shows animate-pulse skeleton while loading", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { container } = render(
      <HealthConnectGuard>
        <div data-testid="child-content">Protected content</div>
      </HealthConnectGuard>,
    );

    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("returns null when data is undefined (not loading)", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    const { container } = render(
      <HealthConnectGuard>
        <div data-testid="child-content">Protected content</div>
      </HealthConnectGuard>,
    );

    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
    expect(container.innerHTML).toBe("");
  });

  it("fetches from /api/auth/session", () => {
    mockUseSWR.mockReturnValue({ data: { healthConnected: true }, isLoading: false });
    render(
      <HealthConnectGuard>
        <div>content</div>
      </HealthConnectGuard>,
    );
    expect(mockUseSWR).toHaveBeenCalledWith("/api/auth/session", expect.anything());
  });

  // FOO-1132: error state — no blank page on /api/auth/session error
  it("shows error state with retry button when SWR errors (no blank page)", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("network error"),
      isLoading: false,
      mutate: vi.fn(),
    });

    const { container } = render(
      <HealthConnectGuard>
        <div data-testid="child-content">Protected content</div>
      </HealthConnectGuard>,
    );

    // Not blank
    expect(container.innerHTML).not.toBe("");
    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
    // Should show a retry button
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows a distinct timeout message when SWR errors with TimeoutError", () => {
    const timeoutError = new DOMException("Timeout", "TimeoutError");
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: timeoutError,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(
      <HealthConnectGuard>
        <div>Protected content</div>
      </HealthConnectGuard>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/timed? ?out/i);
  });
});
