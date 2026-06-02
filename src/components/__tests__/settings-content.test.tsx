import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { SettingsContent } from "../settings-content";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

vi.mock("@/components/health-profile-card", () => ({
  HealthProfileCard: () => <div data-testid="health-profile-card" />,
}));

vi.mock("@/components/daily-goals-card", () => ({
  DailyGoalsCard: () => <div data-testid="daily-goals-card" />,
}));

vi.mock("@/components/targets-card", () => ({
  TargetsCard: ({ date }: { date: string }) => (
    <div data-testid="targets-card" data-date={date} />
  ),
}));

const mockGetTodayDate = vi.fn();
vi.mock("@/lib/date-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/date-utils")>("@/lib/date-utils");
  return {
    ...actual,
    getTodayDate: () => mockGetTodayDate(),
  };
});

// Create a mockable useSWR function
const mockUseSWRImplementation = vi.fn();
vi.mock("swr", () => ({
  default: (key: string, ...args: unknown[]) => mockUseSWRImplementation(key, ...args),
}));

describe("SettingsContent", () => {
  beforeEach(() => {
    mockGetTodayDate.mockReturnValue("2026-05-04");
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/auth/session") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });
  });

  it("does not render SkipLink (SkipLink is in page.tsx)", () => {
    render(<SettingsContent />);
    expect(screen.queryByText("Skip to main content")).not.toBeInTheDocument();
  });

  it("does not render main element (main is in page.tsx)", () => {
    render(<SettingsContent />);
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
  });

  it("renders Settings h1 heading", () => {
    render(<SettingsContent />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
  });

  it("does not render back arrow link", () => {
    render(<SettingsContent />);
    expect(screen.queryByRole("link", { name: /back to food scanner/i })).not.toBeInTheDocument();
  });

  it("renders the daily goals card", () => {
    render(<SettingsContent />);
    expect(screen.getByTestId("daily-goals-card")).toBeInTheDocument();
  });

  it("renders the daily targets section with today's date", () => {
    render(<SettingsContent />);
    expect(screen.getByRole("heading", { name: /today.s targets/i })).toBeInTheDocument();
    const card = screen.getByTestId("targets-card");
    // YYYY-MM-DD pattern from getTodayDate()
    expect(card.getAttribute("data-date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("DailyTargetsSection updates date when visibility becomes visible after midnight (FOO-1007)", async () => {
    mockGetTodayDate.mockReturnValue("2026-05-04");
    render(<SettingsContent />);
    expect(screen.getByTestId("targets-card").getAttribute("data-date")).toBe("2026-05-04");

    // Tab is hidden — record state.
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Time advances past midnight, app returns to tab.
    mockGetTodayDate.mockReturnValue("2026-05-05");
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("targets-card").getAttribute("data-date")).toBe("2026-05-05");
    });
  });

  it("renders Google Health status text when session has healthConnected", () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/auth/session") {
        return { data: { email: "test@example.com", healthConnected: true, expiresAt: Date.now() + 86400000 }, error: null };
      }
      return { data: null, error: null };
    });

    render(<SettingsContent />);
    // "Google Health: Connected" should appear in the session info
    const googleHealthText = screen.getAllByText(/google health/i);
    expect(googleHealthText.length).toBeGreaterThan(0);
  });

  it("renders connect/reconnect Link to /app/connect-health", () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/auth/session") {
        return { data: { email: "test@example.com", healthConnected: false, expiresAt: Date.now() + 86400000 }, error: null };
      }
      return { data: null, error: null };
    });

    render(<SettingsContent />);
    const link = screen.getByRole("link", { name: /connect google health/i });
    expect(link).toHaveAttribute("href", "/app/connect-health");
  });

  it("renders HealthProfileCard component", () => {
    render(<SettingsContent />);
    expect(screen.getByTestId("health-profile-card")).toBeInTheDocument();
  });

  it("does not render credential edit UI (no Client ID / Client Secret fields)", () => {
    render(<SettingsContent />);
    expect(screen.queryByText(/client id/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/client secret/i)).not.toBeInTheDocument();
  });

  describe("accessibility - theme buttons", () => {
    it("theme toggle buttons do not have aria-label attributes", () => {
      render(<SettingsContent />);

      const lightButton = screen.getByRole("button", { name: /light/i });
      expect(lightButton).not.toHaveAttribute("aria-label");

      const darkButton = screen.getByRole("button", { name: /dark/i });
      expect(darkButton).not.toHaveAttribute("aria-label");

      const systemButton = screen.getByRole("button", { name: /system/i });
      expect(systemButton).not.toHaveAttribute("aria-label");
    });
  });

});
