import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn().mockResolvedValue({ userId: "test-user", sessionId: "session-1" }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/components/chat-page-client", () => ({
  ChatPageClient: () => <div data-testid="chat-page-client" />,
}));

vi.mock("@/components/fitbit-setup-guard", () => ({
  FitbitSetupGuard: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="fitbit-setup-guard">{children}</div>
  ),
}));

vi.mock("@/components/skip-link", () => ({
  SkipLink: () => null,
}));

const { default: ChatPage } = await import("@/app/app/chat/page");

describe("ChatPage", () => {
  it("renders FitbitSetupGuard wrapping ChatPageClient", async () => {
    const element = await ChatPage();
    render(element);

    const guard = screen.getByTestId("fitbit-setup-guard");
    expect(guard).toBeInTheDocument();
    const client = screen.getByTestId("chat-page-client");
    expect(client).toBeInTheDocument();
    expect(guard).toContainElement(client);
  });
});
