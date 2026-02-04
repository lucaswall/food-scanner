import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

// Mock next/headers cookies
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
  }),
}));

// Mock iron-session — return empty session (not logged in)
vi.mock("iron-session", () => ({
  getIronSession: vi.fn().mockResolvedValue({}),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const { default: Home } = await import("@/app/page");

describe("Landing page", () => {
  it("renders app name 'Food Scanner'", async () => {
    const jsx = await Home();
    render(jsx);
    expect(screen.getByText("Food Scanner")).toBeInTheDocument();
  });

  it("renders 'Login with Google' button", async () => {
    const jsx = await Home();
    render(jsx);
    expect(
      screen.getByRole("button", { name: /login with google/i }),
    ).toBeInTheDocument();
  });
});
