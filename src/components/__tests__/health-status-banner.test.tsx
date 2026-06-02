import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HealthConnectionStatus } from "@/types";

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

const { HealthStatusBanner } = await import("@/components/health-status-banner");

beforeEach(() => {
  vi.clearAllMocks();
});

function mockHealthStatus(data: HealthConnectionStatus | undefined, opts?: { isLoading?: boolean; error?: Error }) {
  mockUseSWR.mockReturnValue({
    data,
    error: opts?.error,
    isLoading: opts?.isLoading ?? false,
  });
}

describe("HealthStatusBanner", () => {
  it("returns null when status is healthy", () => {
    mockHealthStatus({ status: "healthy" });
    const { container } = render(<HealthStatusBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null when loading", () => {
    mockHealthStatus(undefined, { isLoading: true });
    const { container } = render(<HealthStatusBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null when there is an error (fail silently)", () => {
    mockHealthStatus(undefined, { error: new Error("fetch failed") });
    const { container } = render(<HealthStatusBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("shows 'Connect Google Health' CTA with link to /app/connect-health when needs_reconnect", () => {
    mockHealthStatus({ status: "needs_reconnect" });
    render(<HealthStatusBanner />);
    expect(screen.getByText(/google health/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /connect/i });
    expect(link).toHaveAttribute("href", "/app/connect-health");
  });

  it("shows banner when scope_mismatch", () => {
    mockHealthStatus({ status: "scope_mismatch", missingScopes: ["fitness.nutrition.write"] });
    render(<HealthStatusBanner />);
    expect(screen.getByText(/google health/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /reconnect/i });
    expect(link).toHaveAttribute("href", "/app/connect-health");
  });

  it("SWR fetches from /api/health-status", () => {
    mockHealthStatus({ status: "healthy" });
    render(<HealthStatusBanner />);
    const swrCall = mockUseSWR.mock.calls[0];
    expect(swrCall[0]).toBe("/api/health-status");
  });
});
