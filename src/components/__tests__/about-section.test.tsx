import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AboutSection } from "../about-section";

const mockUseSWR = vi.fn();

vi.mock("swr", () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

const mockHealthData = {
  status: "ok",
  version: "1.11.0",
  environment: "Production",
  fitbitMode: "Live",
  claudeModel: "claude-sonnet-4-6",
  commitHash: "",
};

describe("AboutSection", () => {
  beforeEach(() => {
    mockUseSWR.mockClear();
  });

  it("shows loading skeleton while fetching", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
    });

    render(<AboutSection />);

    expect(screen.getByTestId("about-section-loading")).toBeInTheDocument();
  });

  it("renders version in successful state", () => {
    mockUseSWR.mockReturnValue({
      data: mockHealthData,
      error: null,
      isLoading: false,
    });

    render(<AboutSection />);

    expect(screen.getByText("1.11.0")).toBeInTheDocument();
  });

  it("renders environment in successful state", () => {
    mockUseSWR.mockReturnValue({
      data: mockHealthData,
      error: null,
      isLoading: false,
    });

    render(<AboutSection />);

    expect(screen.getByText("Production")).toBeInTheDocument();
  });

  it("renders Fitbit mode in successful state", () => {
    mockUseSWR.mockReturnValue({
      data: mockHealthData,
      error: null,
      isLoading: false,
    });

    render(<AboutSection />);

    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("renders Claude model in successful state", () => {
    mockUseSWR.mockReturnValue({
      data: mockHealthData,
      error: null,
      isLoading: false,
    });

    render(<AboutSection />);

    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
  });

  it("renders GitHub Releases link with correct href", () => {
    mockUseSWR.mockReturnValue({
      data: mockHealthData,
      error: null,
      isLoading: false,
    });

    render(<AboutSection />);

    const link = screen.getByRole("link", { name: /releases/i });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/lucaswall/food-scanner/releases"
    );
  });

  it("renders GitHub Releases link with target=_blank and rel=noopener noreferrer", () => {
    mockUseSWR.mockReturnValue({
      data: mockHealthData,
      error: null,
      isLoading: false,
    });

    render(<AboutSection />);

    const link = screen.getByRole("link", { name: /releases/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows error message when SWR returns error", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("HTTP 500"),
      isLoading: false,
    });

    render(<AboutSection />);

    expect(
      screen.getByText(/unable to load/i)
    ).toBeInTheDocument();
  });

  it("uses SWR with /api/health endpoint and apiFetcher", () => {
    mockUseSWR.mockReturnValue({
      data: mockHealthData,
      error: null,
      isLoading: false,
    });

    render(<AboutSection />);

    expect(mockUseSWR).toHaveBeenCalledWith(
      "/api/health",
      expect.any(Function)
    );
  });

  it("renders card layout with proper styling", () => {
    mockUseSWR.mockReturnValue({
      data: mockHealthData,
      error: null,
      isLoading: false,
    });

    const { container } = render(<AboutSection />);

    const card = container.querySelector(".rounded-xl.border.bg-card");
    expect(card).toBeInTheDocument();
  });

  it("displays header 'About'", () => {
    mockUseSWR.mockReturnValue({
      data: mockHealthData,
      error: null,
      isLoading: false,
    });

    render(<AboutSection />);

    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("renders Commit row with hash in monospace when commitHash is non-empty", () => {
    mockUseSWR.mockReturnValue({
      data: { ...mockHealthData, commitHash: "abc1234" },
      error: null,
      isLoading: false,
    });

    render(<AboutSection />);

    expect(screen.getByText("Commit")).toBeInTheDocument();
    const commitValue = screen.getByText("abc1234");
    expect(commitValue).toBeInTheDocument();
    expect(commitValue).toHaveClass("font-mono");
  });

  it("does not render Commit row when commitHash is empty", () => {
    mockUseSWR.mockReturnValue({
      data: { ...mockHealthData, commitHash: "" },
      error: null,
      isLoading: false,
    });

    render(<AboutSection />);

    expect(screen.queryByText("Commit")).not.toBeInTheDocument();
  });
});
