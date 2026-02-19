import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsContent } from "../settings-content";

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
    expect(screen.queryByLabelText("Back to Food Scanner")).not.toBeInTheDocument();
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
});
