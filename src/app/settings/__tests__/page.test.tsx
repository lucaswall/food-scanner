import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock fetch for /api/auth/session
global.fetch = vi.fn().mockResolvedValue({
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

const { default: SettingsPage } = await import("@/app/settings/page");

describe("Settings page", () => {
  it("renders 'Settings' heading", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders 'Reconnect Fitbit' button", () => {
    render(<SettingsPage />);
    expect(
      screen.getByRole("button", { name: /reconnect fitbit/i }),
    ).toBeInTheDocument();
  });

  it("renders 'Logout' button", () => {
    render(<SettingsPage />);
    expect(
      screen.getByRole("button", { name: /logout/i }),
    ).toBeInTheDocument();
  });
});
