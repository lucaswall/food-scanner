import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

vi.mock("@/lib/swr", () => ({
  apiFetcher: vi.fn(),
}));

const { FitbitSetupGuard } = await import("@/components/fitbit-setup-guard");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FitbitSetupGuard", () => {
  it("renders children when fully connected and has credentials", () => {
    mockUseSWR.mockReturnValue({
      data: { fitbitConnected: true, hasFitbitCredentials: true },
      isLoading: false,
    });

    render(
      <FitbitSetupGuard>
        <div data-testid="child-content">Protected content</div>
      </FitbitSetupGuard>,
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("shows setup message when no credentials", () => {
    mockUseSWR.mockReturnValue({
      data: { fitbitConnected: false, hasFitbitCredentials: false },
      isLoading: false,
    });

    render(
      <FitbitSetupGuard>
        <div data-testid="child-content">Protected content</div>
      </FitbitSetupGuard>,
    );

    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
    expect(screen.getByText("Set up your Fitbit credentials to start logging food")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /set up fitbit/i });
    expect(link).toHaveAttribute("href", "/app/setup-fitbit");
  });

  it("shows reconnect form when has credentials but no tokens", () => {
    mockUseSWR.mockReturnValue({
      data: { fitbitConnected: false, hasFitbitCredentials: true },
      isLoading: false,
    });

    render(
      <FitbitSetupGuard>
        <div data-testid="child-content">Protected content</div>
      </FitbitSetupGuard>,
    );

    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
    expect(screen.getByText("Connect your Fitbit account to start logging food")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect fitbit/i })).toBeInTheDocument();
  });

  it("shows setup message in transitional state (connected but no credentials)", () => {
    mockUseSWR.mockReturnValue({
      data: { fitbitConnected: true, hasFitbitCredentials: false },
      isLoading: false,
    });

    render(
      <FitbitSetupGuard>
        <div data-testid="child-content">Protected content</div>
      </FitbitSetupGuard>,
    );

    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
    expect(screen.getByText("Set up your Fitbit credentials to start logging food")).toBeInTheDocument();
  });

  it("shows skeleton placeholder while loading", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { container } = render(
      <FitbitSetupGuard>
        <div data-testid="child-content">Protected content</div>
      </FitbitSetupGuard>,
    );

    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });
});
