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

  it("calls Sentry.setUser with id only (no email — PII not sent to Sentry)", () => {
    render(<SentryUserContext userId="user-123" />);
    expect(mockSetUser).toHaveBeenCalledWith({ id: "user-123" });
    expect(mockSetUser).toHaveBeenCalledTimes(1);
  });

  it("does not include email in the Sentry user context", () => {
    render(<SentryUserContext userId="user-123" />);
    const callArg = mockSetUser.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("email");
  });

  it("calls Sentry.setUser(null) on unmount", () => {
    render(<SentryUserContext userId="user-123" />);
    cleanup();
    expect(mockSetUser).toHaveBeenCalledWith(null);
  });

  it("renders nothing (returns null)", () => {
    const { container } = render(<SentryUserContext userId="user-123" />);
    expect(container).toBeEmptyDOMElement();
  });
});
