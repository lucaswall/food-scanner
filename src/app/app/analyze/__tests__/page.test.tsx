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
  FoodAnalyzer: ({ autoCapture }: { autoCapture?: boolean }) => (
    <div data-testid="food-analyzer" data-auto-capture={autoCapture ? "true" : undefined}>
      FoodAnalyzer
    </div>
  ),
}));

const { default: AnalyzePage } = await import("@/app/app/analyze/page");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "test-user-uuid",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

describe("/app/analyze page", () => {
  it("redirects to / when session is null", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(AnalyzePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("renders 'Analyze Food' heading", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AnalyzePage({ searchParams: Promise.resolve({}) });
    render(jsx);
    expect(screen.getByText("Analyze Food")).toBeInTheDocument();
  });

  it("renders FoodAnalyzer component", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AnalyzePage({ searchParams: Promise.resolve({}) });
    render(jsx);
    expect(screen.getByTestId("food-analyzer")).toBeInTheDocument();
  });

  it("passes autoCapture=true to FoodAnalyzer when searchParams has autoCapture", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AnalyzePage({ searchParams: Promise.resolve({ autoCapture: "true" }) });
    render(jsx);
    expect(screen.getByTestId("food-analyzer")).toHaveAttribute("data-auto-capture", "true");
  });

  it("does not pass autoCapture when searchParams lacks autoCapture", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AnalyzePage({ searchParams: Promise.resolve({}) });
    render(jsx);
    expect(screen.getByTestId("food-analyzer")).not.toHaveAttribute("data-auto-capture");
  });
});
