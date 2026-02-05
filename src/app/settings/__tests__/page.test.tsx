import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { default: SettingsPage } = await import("@/app/settings/page");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Settings page", () => {
  it("renders 'Settings' heading", () => {
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

    render(<SettingsPage />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders 'Reconnect Fitbit' button", () => {
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

    render(<SettingsPage />);
    expect(
      screen.getByRole("button", { name: /reconnect fitbit/i }),
    ).toBeInTheDocument();
  });

  it("renders 'Logout' button", () => {
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

    render(<SettingsPage />);
    expect(
      screen.getByRole("button", { name: /logout/i }),
    ).toBeInTheDocument();
  });

  it("displays error message when session fetch fails with network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    render(<SettingsPage />);

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

    render(<SettingsPage />);

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

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load|session expired/i)).toBeInTheDocument();
    });
  });
});
