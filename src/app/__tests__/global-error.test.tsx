import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import GlobalError from "../global-error";

describe("GlobalError", () => {
  const mockError = new Error("Test error message");
  Object.defineProperty(mockError, "digest", { value: "abc123" });
  const mockReset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("captures exception with Sentry", () => {
    render(<GlobalError error={mockError} reset={mockReset} />);

    expect(Sentry.captureException).toHaveBeenCalledWith(mockError);
  });

  it("renders error message and try again button", () => {
    render(<GlobalError error={mockError} reset={mockReset} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("calls reset when try again button is clicked", async () => {
    const user = userEvent.setup();
    render(<GlobalError error={mockError} reset={mockReset} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(mockReset).toHaveBeenCalledOnce();
  });
});
