import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRProvider } from "../swr-provider";
import { ApiError } from "@/lib/swr";

interface SwrGlobal {
  __swrOnError?: (error: Error) => void;
}

// Mock SWR to control errors
vi.mock("swr", () => ({
  default: vi.fn(),
  SWRConfig: ({ children, value }: { children: React.ReactNode; value: { onError: (error: Error) => void } }) => {
    (globalThis as unknown as SwrGlobal).__swrOnError = value.onError;
    return <>{children}</>;
  },
}));

describe("SWRProvider", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
      configurable: true,
    });

    delete (globalThis as unknown as SwrGlobal).__swrOnError;
  });

  it("renders children normally when no error occurs", () => {
    render(
      <SWRProvider>
        <div>Test Child</div>
      </SWRProvider>
    );

    expect(screen.getByText("Test Child")).toBeInTheDocument();
  });

  it("redirects to / when ApiError with AUTH_MISSING_SESSION occurs", async () => {
    const error = new ApiError("Session expired", "AUTH_MISSING_SESSION");

    render(
      <SWRProvider>
        <div>Test Child</div>
      </SWRProvider>
    );

    // Trigger the onError handler that SWRConfig registered
    const onError = (globalThis as unknown as SwrGlobal).__swrOnError;
    expect(onError).toBeDefined();

    onError!(error);

    await waitFor(() => {
      expect(window.location.href).toBe("/");
    });
  });

  it("does not redirect when ApiError with other error code occurs", async () => {
    const error = new ApiError("Token invalid", "FITBIT_TOKEN_INVALID");

    render(
      <SWRProvider>
        <div>Test Child</div>
      </SWRProvider>
    );

    const onError = (globalThis as unknown as SwrGlobal).__swrOnError;
    expect(onError).toBeDefined();

    onError!(error);

    await waitFor(() => {
      expect(window.location.href).toBe("");
    });
  });

  it("does not redirect when non-ApiError occurs", async () => {
    const error = new Error("Generic error");

    render(
      <SWRProvider>
        <div>Test Child</div>
      </SWRProvider>
    );

    const onError = (globalThis as unknown as SwrGlobal).__swrOnError;
    expect(onError).toBeDefined();

    onError!(error);

    await waitFor(() => {
      expect(window.location.href).toBe("");
    });
  });
});
