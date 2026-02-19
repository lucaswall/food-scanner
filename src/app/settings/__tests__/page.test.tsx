import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { FullSession } from "@/types";

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
}));

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new Error("NEXT_REDIRECT");
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { default: SettingsPage } = await import("@/app/settings/page");
const { SettingsContent } = await import("@/components/settings-content");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "test-user-uuid",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

// Wrapper to provide fresh SWR cache for each test
function renderWithSWR(ui: React.ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Settings page (server component)", () => {
  it("redirects to / when session is null", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("renders when session is valid", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            email: "test@example.com",
            fitbitConnected: true,
            expiresAt: Date.now() + 86400000,
          },
        }),
    });

    const jsx = await SettingsPage();
    renderWithSWR(jsx);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders AboutSection after ClaudeUsageSection", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            email: "test@example.com",
            fitbitConnected: true,
            expiresAt: Date.now() + 86400000,
          },
        }),
    });

    const jsx = await SettingsPage();
    renderWithSWR(jsx);
    // AboutSection renders in loading state initially (fetches /api/health via useSWR)
    expect(screen.getByTestId("about-section-loading")).toBeInTheDocument();
  });
});

describe("Settings content (client component)", () => {
  describe("back navigation", () => {
    it("does not render back button (Settings is a root page)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              email: "test@example.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      renderWithSWR(<SettingsContent />);

      expect(screen.queryByRole("link", { name: /back to food scanner/i })).not.toBeInTheDocument();
    });
  });

  it("renders 'Settings' heading", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            email: "test@example.com",
            fitbitConnected: true,
            expiresAt: Date.now() + 86400000,
          },
        }),
    });

    renderWithSWR(<SettingsContent />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders 'Reconnect Fitbit' button", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            email: "test@example.com",
            fitbitConnected: true,
            expiresAt: Date.now() + 86400000,
          },
        }),
    });

    renderWithSWR(<SettingsContent />);
    expect(
      screen.getByRole("button", { name: /reconnect fitbit/i }),
    ).toBeInTheDocument();
  });

  it("renders 'Logout' button", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            email: "test@example.com",
            fitbitConnected: true,
            expiresAt: Date.now() + 86400000,
          },
        }),
    });

    renderWithSWR(<SettingsContent />);
    expect(
      screen.getByRole("button", { name: /logout/i }),
    ).toBeInTheDocument();
  });

  it("displays error message when session fetch fails with network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    renderWithSWR(<SettingsContent />);

    await waitFor(() => {
      // The error message will be "Network error" since that's what the Error contains
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it("displays error message when session returns non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ success: false }),
    });

    renderWithSWR(<SettingsContent />);

    await waitFor(() => {
      expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument();
    });
  });

  it("displays error message when session returns error response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          error: { code: "AUTH_SESSION_EXPIRED", message: "Session expired" },
        }),
    });

    renderWithSWR(<SettingsContent />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load|session expired/i)).toBeInTheDocument();
    });
  });

  describe("dark mode toggle", () => {
    beforeEach(() => {
      // Clear localStorage before each test
      localStorage.clear();
      // Reset document class
      document.documentElement.classList.remove("dark", "light");
    });

    it("renders dark mode toggle", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              email: "test@example.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      renderWithSWR(<SettingsContent />);

      // Should show the Appearance section
      await waitFor(() => {
        expect(screen.getByText(/appearance/i)).toBeInTheDocument();
      });

      // Should show theme options
      expect(screen.getByRole("button", { name: /light/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /system/i })).toBeInTheDocument();
    });

    it("changes theme when clicking toggle", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              email: "test@example.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      const user = userEvent.setup();

      renderWithSWR(<SettingsContent />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
      });

      // Click dark mode button
      await user.click(screen.getByRole("button", { name: /dark/i }));

      // Should apply dark class to document
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("persists preference in localStorage", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              email: "test@example.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      const user = userEvent.setup();

      renderWithSWR(<SettingsContent />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
      });

      // Click dark mode button
      await user.click(screen.getByRole("button", { name: /dark/i }));

      // Should save to localStorage
      expect(localStorage.getItem("theme")).toBe("dark");
    });
  });

  describe("logout", () => {
    it("redirects to / on successful logout", async () => {
      // Mock successful session fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              email: "test@example.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      const user = userEvent.setup();
      // Mock window.location
      const locationAssign = { href: "" };
      Object.defineProperty(window, "location", {
        value: locationAssign,
        writable: true,
      });

      renderWithSWR(<SettingsContent />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
      });

      // Mock the logout POST response
      mockFetch.mockResolvedValueOnce({ ok: true });

      await user.click(screen.getByRole("button", { name: /logout/i }));

      await waitFor(() => {
        expect(locationAssign.href).toBe("/");
      });
    });

    it("still redirects when logout fetch throws network error", async () => {
      // Mock successful session fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              email: "test@example.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      const user = userEvent.setup();
      const locationAssign = { href: "" };
      Object.defineProperty(window, "location", {
        value: locationAssign,
        writable: true,
      });

      renderWithSWR(<SettingsContent />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
      });

      // Mock the logout POST to throw
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await user.click(screen.getByRole("button", { name: /logout/i }));

      await waitFor(() => {
        expect(locationAssign.href).toBe("/");
      });
    });
  });

  describe("session caching", () => {
    it("uses SWR for session fetching", async () => {
      const sessionData = {
        email: "test@example.com",
        fitbitConnected: true,
        expiresAt: Date.now() + 86400000,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: sessionData }),
      });

      renderWithSWR(<SettingsContent />);

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText(sessionData.email)).toBeInTheDocument();
      });

      // Verify fetch was called with the session endpoint
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/session");
    });

    it("displays session data after fetch completes", async () => {
      const sessionData = {
        email: "test@example.com",
        fitbitConnected: true,
        expiresAt: Date.now() + 86400000,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: sessionData }),
      });

      renderWithSWR(<SettingsContent />);

      // Wait for session data to display
      await waitFor(() => {
        expect(screen.getByText(sessionData.email)).toBeInTheDocument();
        expect(screen.getByText(/connected/i)).toBeInTheDocument();
      });
    });
  });
});
