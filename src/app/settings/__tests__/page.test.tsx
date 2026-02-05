import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { default: SettingsPage } = await import("@/app/settings/page");

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

describe("Settings page", () => {
  describe("back navigation", () => {
    it("renders back button that links to /app", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              email: "wall.lucas@gmail.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      renderWithSWR(<SettingsPage />);

      const backButton = screen.getByRole("link", { name: /back to food scanner/i });
      expect(backButton).toBeInTheDocument();
      expect(backButton).toHaveAttribute("href", "/app");
    });

    it("back button has proper touch target size", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              email: "wall.lucas@gmail.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      renderWithSWR(<SettingsPage />);

      const backButton = screen.getByRole("link", { name: /back to food scanner/i });
      expect(backButton).toHaveClass("min-h-[44px]");
      expect(backButton).toHaveClass("min-w-[44px]");
    });
  });

  it("renders 'Settings' heading", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            email: "wall.lucas@gmail.com",
            fitbitConnected: true,
            expiresAt: Date.now() + 86400000,
          },
        }),
    });

    renderWithSWR(<SettingsPage />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders 'Reconnect Fitbit' button", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            email: "wall.lucas@gmail.com",
            fitbitConnected: true,
            expiresAt: Date.now() + 86400000,
          },
        }),
    });

    renderWithSWR(<SettingsPage />);
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
            email: "wall.lucas@gmail.com",
            fitbitConnected: true,
            expiresAt: Date.now() + 86400000,
          },
        }),
    });

    renderWithSWR(<SettingsPage />);
    expect(
      screen.getByRole("button", { name: /logout/i }),
    ).toBeInTheDocument();
  });

  it("displays error message when session fetch fails with network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    renderWithSWR(<SettingsPage />);

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

    renderWithSWR(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
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

    renderWithSWR(<SettingsPage />);

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
              email: "wall.lucas@gmail.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      renderWithSWR(<SettingsPage />);

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
              email: "wall.lucas@gmail.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      const user = userEvent.setup();

      renderWithSWR(<SettingsPage />);

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
              email: "wall.lucas@gmail.com",
              fitbitConnected: true,
              expiresAt: Date.now() + 86400000,
            },
          }),
      });

      const user = userEvent.setup();

      renderWithSWR(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /dark/i })).toBeInTheDocument();
      });

      // Click dark mode button
      await user.click(screen.getByRole("button", { name: /dark/i }));

      // Should save to localStorage
      expect(localStorage.getItem("theme")).toBe("dark");
    });
  });

  describe("session caching", () => {
    it("uses SWR for session fetching", async () => {
      const sessionData = {
        email: "wall.lucas@gmail.com",
        fitbitConnected: true,
        expiresAt: Date.now() + 86400000,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: sessionData }),
      });

      renderWithSWR(<SettingsPage />);

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText(sessionData.email)).toBeInTheDocument();
      });

      // Verify fetch was called with the session endpoint
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/session");
    });

    it("displays session data after fetch completes", async () => {
      const sessionData = {
        email: "wall.lucas@gmail.com",
        fitbitConnected: true,
        expiresAt: Date.now() + 86400000,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: sessionData }),
      });

      renderWithSWR(<SettingsPage />);

      // Wait for session data to display
      await waitFor(() => {
        expect(screen.getByText(sessionData.email)).toBeInTheDocument();
        expect(screen.getByText(/connected/i)).toBeInTheDocument();
      });
    });
  });
});
