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
});
