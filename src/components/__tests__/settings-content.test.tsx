import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsContent } from "../settings-content";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("swr", () => ({
  default: () => ({ data: null, error: null }),
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

describe("SettingsContent", () => {
  it("renders SkipLink pointing to #main-content", () => {
    render(<SettingsContent />);
    const skipLink = screen.getByText("Skip to main content");
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#main-content");
  });

  it("has id='main-content' on main element", () => {
    render(<SettingsContent />);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
  });
});
