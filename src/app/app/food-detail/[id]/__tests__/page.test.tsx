import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FullSession } from "@/types";

const mockGetSession = vi.fn();
const mockValidateSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new Error("NEXT_REDIRECT");
  },
}));

// Mock SkipLink component
vi.mock("@/components/skip-link", () => ({
  SkipLink: () => <a href="#main-content">Skip to main content</a>,
}));

// Mock FoodDetail component
vi.mock("@/components/food-detail", () => ({
  FoodDetail: ({ entryId }: { entryId: string }) => (
    <div data-testid="food-detail-mock">FoodDetail: {entryId}</div>
  ),
}));

const { default: FoodDetailPage } = await import("@/app/app/food-detail/[id]/page");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "test-user-uuid",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

describe("FoodDetailPage", () => {
  it("redirects to / when session validation fails", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockValidateSession.mockReturnValue("Session expired");

    await expect(
      FoodDetailPage({ params: Promise.resolve({ id: "test-id" }) })
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("renders SkipLink with href=#main-content", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockValidateSession.mockReturnValue(null);

    const jsx = await FoodDetailPage({ params: Promise.resolve({ id: "test-id" }) });
    render(jsx);

    const skipLink = screen.getByText("Skip to main content");
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#main-content");
  });

  it("renders main element with id=main-content", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockValidateSession.mockReturnValue(null);

    const jsx = await FoodDetailPage({ params: Promise.resolve({ id: "test-id" }) });
    render(jsx);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
  });

  it("renders FoodDetail component with correct entryId", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockValidateSession.mockReturnValue(null);

    const jsx = await FoodDetailPage({ params: Promise.resolve({ id: "test-entry-123" }) });
    render(jsx);

    expect(screen.getByTestId("food-detail-mock")).toBeInTheDocument();
    expect(screen.getByText("FoodDetail: test-entry-123")).toBeInTheDocument();
  });
});
