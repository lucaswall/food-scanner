import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn().mockResolvedValue({ userId: "test-user", sessionId: "session-1" }),
  validateSession: vi.fn().mockReturnValue(null),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/components/edit-food", () => ({
  EditFood: ({ entryId }: { entryId: string }) => (
    <div data-testid="edit-food" data-entry-id={entryId} />
  ),
}));

vi.mock("@/components/fitbit-setup-guard", () => ({
  FitbitSetupGuard: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="fitbit-setup-guard">{children}</div>
  ),
}));

vi.mock("@/components/skip-link", () => ({
  SkipLink: () => null,
}));

const { default: EditFoodPage } = await import("@/app/app/edit/[id]/page");

describe("EditFoodPage", () => {
  it("renders FitbitSetupGuard wrapping EditFood", async () => {
    const element = await EditFoodPage({ params: Promise.resolve({ id: "42" }) });
    render(element);

    const guard = screen.getByTestId("fitbit-setup-guard");
    expect(guard).toBeInTheDocument();
    const editFood = screen.getByTestId("edit-food");
    expect(editFood).toBeInTheDocument();
    expect(guard).toContainElement(editFood);
  });

  it("passes the correct entryId to EditFood", async () => {
    const element = await EditFoodPage({ params: Promise.resolve({ id: "99" }) });
    render(element);

    expect(screen.getByTestId("edit-food")).toHaveAttribute("data-entry-id", "99");
  });
});
