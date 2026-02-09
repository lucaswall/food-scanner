import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FitbitSetupForm } from "../fitbit-setup-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

global.fetch = vi.fn();

describe("FitbitSetupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Client ID and Client Secret input fields", () => {
    render(<FitbitSetupForm />);
    expect(screen.getByLabelText(/Fitbit Client ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Fitbit Client Secret/i)).toBeInTheDocument();
  });

  it("renders submit button", () => {
    render(<FitbitSetupForm />);
    expect(screen.getByRole("button", { name: /Connect Fitbit/i })).toBeInTheDocument();
  });

  it("submit button is disabled when fields are empty", () => {
    render(<FitbitSetupForm />);
    const submitButton = screen.getByRole("button", { name: /Connect Fitbit/i });
    expect(submitButton).toBeDisabled();
  });

  it("submit button is enabled when both fields are filled", async () => {
    const user = userEvent.setup();
    render(<FitbitSetupForm />);

    const clientIdInput = screen.getByLabelText(/Fitbit Client ID/i);
    const clientSecretInput = screen.getByLabelText(/Fitbit Client Secret/i);
    const submitButton = screen.getByRole("button", { name: /Connect Fitbit/i });

    await user.type(clientIdInput, "test-client-id");
    await user.type(clientSecretInput, "test-client-secret");

    expect(submitButton).toBeEnabled();
  });

  it("calls POST /api/fitbit-credentials on submit", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<FitbitSetupForm />);

    const clientIdInput = screen.getByLabelText(/Fitbit Client ID/i);
    const clientSecretInput = screen.getByLabelText(/Fitbit Client Secret/i);
    const submitButton = screen.getByRole("button", { name: /Connect Fitbit/i });

    await user.type(clientIdInput, "test-client-id");
    await user.type(clientSecretInput, "test-client-secret");
    await user.click(submitButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/fitbit-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        }),
      });
    });
  });

  it("shows loading state during submission", async () => {
    const user = userEvent.setup();
    let resolvePromise: (value: unknown) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(promise);

    render(<FitbitSetupForm />);

    const clientIdInput = screen.getByLabelText(/Fitbit Client ID/i);
    const clientSecretInput = screen.getByLabelText(/Fitbit Client Secret/i);
    const submitButton = screen.getByRole("button", { name: /Connect Fitbit/i });

    await user.type(clientIdInput, "test-client-id");
    await user.type(clientSecretInput, "test-client-secret");
    await user.click(submitButton);

    // Button should be disabled during loading
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveTextContent("Saving...");

    resolvePromise!({
      ok: true,
      json: async () => ({ success: true }),
    });

    // On success, the form redirects (window.location.href = ...), so we don't check for re-enabled state
  });

  it("redirects to /api/auth/fitbit on success", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    // Mock window.location.href
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
    });

    render(<FitbitSetupForm />);

    const clientIdInput = screen.getByLabelText(/Fitbit Client ID/i);
    const clientSecretInput = screen.getByLabelText(/Fitbit Client Secret/i);
    const submitButton = screen.getByRole("button", { name: /Connect Fitbit/i });

    await user.type(clientIdInput, "test-client-id");
    await user.type(clientSecretInput, "test-client-secret");
    await user.click(submitButton);

    await waitFor(() => {
      expect(window.location.href).toBe("/api/auth/fitbit");
    });
  });

  it("shows error message on failure", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid credentials" },
      }),
    });

    render(<FitbitSetupForm />);

    const clientIdInput = screen.getByLabelText(/Fitbit Client ID/i);
    const clientSecretInput = screen.getByLabelText(/Fitbit Client Secret/i);
    const submitButton = screen.getByRole("button", { name: /Connect Fitbit/i });

    await user.type(clientIdInput, "test-client-id");
    await user.type(clientSecretInput, "test-client-secret");
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Invalid credentials/i)).toBeInTheDocument();
    });
  });

  it("Client Secret input uses type password", () => {
    render(<FitbitSetupForm />);
    const clientSecretInput = screen.getByLabelText(/Fitbit Client Secret/i);
    expect(clientSecretInput).toHaveAttribute("type", "password");
  });

  it("renders instructions text", () => {
    render(<FitbitSetupForm />);
    expect(screen.getByText(/developer console/i)).toBeInTheDocument();
  });
});
