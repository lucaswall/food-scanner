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

  it("does not log error details to console in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    render(<GlobalError error={mockError} reset={mockReset} />);

    expect(console.error).not.toHaveBeenCalledWith(
      "Global error:",
      expect.objectContaining({ message: "Test error message" })
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
});
