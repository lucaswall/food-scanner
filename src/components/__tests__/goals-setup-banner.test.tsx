import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/link so <Link> renders as a plain <a>
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { GoalsSetupBanner } = await import("@/components/goals-setup-banner");

describe("GoalsSetupBanner", () => {
  // Reason → message mappings
  it("maps goals_not_set → correct message", () => {
    render(<GoalsSetupBanner reason="goals_not_set" />);
    expect(
      screen.getByText(/Set up your daily goals in Settings to see your targets\./i)
    ).toBeInTheDocument();
  });

  it("maps no_weight → correct message", () => {
    render(<GoalsSetupBanner reason="no_weight" />);
    expect(
      screen.getByText(/Log your weight in Fitbit to enable targets\./i)
    ).toBeInTheDocument();
  });

  it("maps sex_unset → correct message", () => {
    render(<GoalsSetupBanner reason="sex_unset" />);
    expect(
      screen.getByText(/Set your biological sex in Fitbit profile to enable targets\./i)
    ).toBeInTheDocument();
  });

  it("maps scope_mismatch → correct message", () => {
    render(<GoalsSetupBanner reason="scope_mismatch" />);
    expect(
      screen.getByText(/Reconnect Fitbit to enable targets\./i)
    ).toBeInTheDocument();
  });

  it("maps invalid_profile → correct message", () => {
    render(<GoalsSetupBanner reason="invalid_profile" />);
    expect(
      screen.getByText(/Your Fitbit profile has invalid values — update it in the Fitbit app\./i)
    ).toBeInTheDocument();
  });

  it("maps invalid_activity → correct message", () => {
    render(<GoalsSetupBanner reason="invalid_activity" />);
    expect(
      screen.getByText(/Fitbit returned invalid activity data — try again later\./i)
    ).toBeInTheDocument();
  });

  // Structural assertions
  it("renders an element with role=alert", () => {
    render(<GoalsSetupBanner reason="goals_not_set" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders a CTA link to /settings labeled 'Open Settings'", () => {
    render(<GoalsSetupBanner reason="goals_not_set" />);
    const link = screen.getByRole("link", { name: /open settings/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/settings");
  });

  it("CTA link meets 44px touch target (min-h-[44px])", () => {
    render(<GoalsSetupBanner reason="goals_not_set" />);
    const link = screen.getByRole("link", { name: /open settings/i });
    expect(link).toHaveClass("min-h-[44px]");
  });

  it("component is purely presentational — no own SWR fetch", () => {
    // If the component imports SWR and calls useSWR without a key mock,
    // the test would hang. Rendering with different reasons verifies no fetch.
    const reasons = [
      "goals_not_set",
      "no_weight",
      "sex_unset",
      "scope_mismatch",
      "invalid_profile",
      "invalid_activity",
    ] as const;
    for (const reason of reasons) {
      const { unmount } = render(<GoalsSetupBanner reason={reason} />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      unmount();
    }
  });
});
