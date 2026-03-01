import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const mockSetUser = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  setUser: mockSetUser,
}));

const { SentryUserContext } = await import("@/components/sentry-user-context");

describe("SentryUserContext", () => {
  beforeEach(() => {
    mockSetUser.mockClear();
  });

  it("calls Sentry.setUser with id and email on mount", () => {
    render(
      <SentryUserContext userId="user-123" email="test@example.com" />,
    );
    expect(mockSetUser).toHaveBeenCalledWith({
      id: "user-123",
      email: "test@example.com",
    });
  });

  it("calls Sentry.setUser(null) on unmount", () => {
    render(
      <SentryUserContext userId="user-123" email="test@example.com" />,
    );
    cleanup();
    expect(mockSetUser).toHaveBeenCalledWith(null);
  });

  it("renders nothing (returns null)", () => {
    const { container } = render(
      <SentryUserContext userId="user-123" email="test@example.com" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
