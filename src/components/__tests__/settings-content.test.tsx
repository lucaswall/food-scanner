import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsContent } from "../settings-content";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

// Create a mockable useSWR function
const mockUseSWRImplementation = vi.fn();
vi.mock("swr", () => ({
  default: (key: string, ...args: unknown[]) => mockUseSWRImplementation(key, ...args),
}));

describe("SettingsContent", () => {
  beforeEach(() => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/auth/session") {
        return { data: null, error: null };
      }
      if (key === "/api/fitbit-credentials") {
        return { data: null, error: null, mutate: vi.fn() };
      }
      return { data: null, error: null };
    });
  });

  it("does not render SkipLink (SkipLink is in page.tsx)", () => {
    render(<SettingsContent />);
    expect(screen.queryByText("Skip to main content")).not.toBeInTheDocument();
  });

  it("does not render main element (main is in page.tsx)", () => {
    render(<SettingsContent />);
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
  });

  it("renders Settings h1 heading", () => {
    render(<SettingsContent />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
  });

  it("does not render back arrow link", () => {
    render(<SettingsContent />);
    expect(screen.queryByRole("link", { name: /back to food scanner/i })).not.toBeInTheDocument();
  });

  describe("accessibility - form labels", () => {
    it("Client ID label has htmlFor and input has matching id", async () => {
      const user = userEvent.setup();
      mockUseSWRImplementation.mockImplementation((key: string) => {
        if (key === "/api/auth/session") {
          return { data: null, error: null };
        }
        if (key === "/api/fitbit-credentials") {
          return { data: { hasCredentials: true, clientId: "test-client-id" }, error: null, mutate: vi.fn() };
        }
        return { data: null, error: null };
      });

      render(<SettingsContent />);

      // Label should be visible immediately (for = htmlFor in DOM)
      const label = screen.getByText("Client ID", { selector: "label" });
      expect(label).toHaveAttribute("for", "fitbit-client-id");

      // Click Edit button to enter edit mode and reveal the input
      const editButton = screen.getByRole("button", { name: /edit/i });
      await user.click(editButton);

      const input = screen.getByDisplayValue("test-client-id");
      expect(input).toHaveAttribute("id", "fitbit-client-id");
    });

    it("Client Secret label has htmlFor and input has matching id", async () => {
      const user = userEvent.setup();
      mockUseSWRImplementation.mockImplementation((key: string) => {
        if (key === "/api/auth/session") {
          return { data: null, error: null };
        }
        if (key === "/api/fitbit-credentials") {
          return { data: { hasCredentials: true, clientId: "test-client-id" }, error: null, mutate: vi.fn() };
        }
        return { data: null, error: null };
      });

      render(<SettingsContent />);

      // Label should be visible immediately (for = htmlFor in DOM)
      const label = screen.getByText("Client Secret", { selector: "label" });
      expect(label).toHaveAttribute("for", "fitbit-client-secret");

      // Click Replace Secret button to enter edit mode and reveal the input
      const replaceButton = screen.getByRole("button", { name: /replace secret/i });
      await user.click(replaceButton);

      const input = screen.getByPlaceholderText("Enter new Client Secret");
      expect(input).toHaveAttribute("id", "fitbit-client-secret");
    });
  });

  describe("accessibility - theme buttons", () => {
    it("theme toggle buttons do not have aria-label attributes", () => {
      render(<SettingsContent />);

      const lightButton = screen.getByRole("button", { name: /light/i });
      expect(lightButton).not.toHaveAttribute("aria-label");

      const darkButton = screen.getByRole("button", { name: /dark/i });
      expect(darkButton).not.toHaveAttribute("aria-label");

      const systemButton = screen.getByRole("button", { name: /system/i });
      expect(systemButton).not.toHaveAttribute("aria-label");
    });
  });

  describe("FOO-664: credentials SWR error state", () => {
    it("shows error message when credentials fetch fails", () => {
      mockUseSWRImplementation.mockImplementation((key: string) => {
        if (key === "/api/auth/session") {
          return { data: null, error: null };
        }
        if (key === "/api/fitbit-credentials") {
          return { data: null, error: new Error("Failed to load"), mutate: vi.fn() };
        }
        return { data: null, error: null };
      });

      render(<SettingsContent />);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });

    it("shows retry button when credentials fetch fails", () => {
      mockUseSWRImplementation.mockImplementation((key: string) => {
        if (key === "/api/auth/session") {
          return { data: null, error: null };
        }
        if (key === "/api/fitbit-credentials") {
          return { data: null, error: new Error("Failed to load"), mutate: vi.fn() };
        }
        return { data: null, error: null };
      });

      render(<SettingsContent />);
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    it("calls mutate when retry button is clicked", async () => {
      const user = userEvent.setup();
      const mockMutate = vi.fn();
      mockUseSWRImplementation.mockImplementation((key: string) => {
        if (key === "/api/auth/session") {
          return { data: null, error: null };
        }
        if (key === "/api/fitbit-credentials") {
          return { data: null, error: new Error("Failed to load"), mutate: mockMutate };
        }
        return { data: null, error: null };
      });

      render(<SettingsContent />);
      await user.click(screen.getByRole("button", { name: /retry/i }));
      expect(mockMutate).toHaveBeenCalled();
    });
  });

  describe("credentials PATCH timeout", () => {
    it("save client ID fetch includes AbortSignal timeout", async () => {
      const user = userEvent.setup();
      const mockMutate = vi.fn();
      mockUseSWRImplementation.mockImplementation((key: string) => {
        if (key === "/api/auth/session") {
          return { data: null, error: null };
        }
        if (key === "/api/fitbit-credentials") {
          return { data: { hasCredentials: true, clientId: "test-client-id" }, error: null, mutate: mockMutate };
        }
        return { data: null, error: null };
      });

      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      render(<SettingsContent />);

      // Click Edit to enter edit mode
      await user.click(screen.getByRole("button", { name: /edit/i }));
      // Type a new value
      const input = screen.getByDisplayValue("test-client-id");
      await user.clear(input);
      await user.type(input, "new-client-id");
      // Click Save
      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/fitbit-credentials",
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });
    });

    it("shows user-friendly message when save client ID times out", async () => {
      const user = userEvent.setup();
      mockUseSWRImplementation.mockImplementation((key: string) => {
        if (key === "/api/auth/session") {
          return { data: null, error: null };
        }
        if (key === "/api/fitbit-credentials") {
          return { data: { hasCredentials: true, clientId: "test-client-id" }, error: null, mutate: vi.fn() };
        }
        return { data: null, error: null };
      });

      mockFetch.mockRejectedValueOnce(new DOMException("signal timed out", "TimeoutError"));

      render(<SettingsContent />);

      await user.click(screen.getByRole("button", { name: /edit/i }));
      const input = screen.getByDisplayValue("test-client-id");
      await user.clear(input);
      await user.type(input, "new-client-id");
      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(screen.getByText(/request timed out/i)).toBeInTheDocument();
      });
    });
  });
});
