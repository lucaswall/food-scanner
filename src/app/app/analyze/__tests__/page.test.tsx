import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("@/components/food-analyzer", () => ({
  FoodAnalyzer: () => <div data-testid="food-analyzer">FoodAnalyzer</div>,
}));

const { default: AnalyzePage } = await import("@/app/app/analyze/page");

const validSession: FullSession = {
  sessionId: "test-session",
  email: "test@example.com",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  destroy: vi.fn(),
};

describe("/app/analyze page", () => {
  it("redirects to / when session is null", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(AnalyzePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("renders 'Analyze Food' heading", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AnalyzePage();
    render(jsx);
    expect(screen.getByText("Analyze Food")).toBeInTheDocument();
  });

  it("renders FoodAnalyzer component", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AnalyzePage();
    render(jsx);
    expect(screen.getByTestId("food-analyzer")).toBeInTheDocument();
  });
});
