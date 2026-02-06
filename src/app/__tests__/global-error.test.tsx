import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import GlobalError from "../global-error";

describe("GlobalError", () => {
  const mockError = new Error("Test error message");
  Object.defineProperty(mockError, "digest", { value: "abc123" });
  const mockReset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("always logs error details to console regardless of environment", () => {
    vi.stubEnv("NODE_ENV", "production");

    render(<GlobalError error={mockError} reset={mockReset} />);

    expect(console.error).toHaveBeenCalledWith(
      "Global error:",
      expect.objectContaining({ message: "Test error message", digest: "abc123" })
    );
  });

  it("logs error details to console in development", () => {
    vi.stubEnv("NODE_ENV", "development");

    render(<GlobalError error={mockError} reset={mockReset} />);

    expect(console.error).toHaveBeenCalledWith(
      "Global error:",
      expect.objectContaining({ message: "Test error message" })
    );
  });

  it("does not include stack trace in production logs", () => {
    vi.stubEnv("NODE_ENV", "production");

    render(<GlobalError error={mockError} reset={mockReset} />);

    const loggedObject = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(loggedObject).not.toHaveProperty("stack");
  });
});
