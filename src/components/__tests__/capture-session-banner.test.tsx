import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CaptureSessionBanner } from "../capture-session-banner";

describe("CaptureSessionBanner", () => {
  it("renders null when captureCount is 0", () => {
    const { container } = render(
      <CaptureSessionBanner captureCount={0} onProcess={vi.fn()} onCapture={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows capture count in banner text", () => {
    render(<CaptureSessionBanner captureCount={3} onProcess={vi.fn()} onCapture={vi.fn()} />);
    expect(screen.getByText(/3 captures ready to process/)).toBeInTheDocument();
  });

  it("shows singular 'capture' for count of 1", () => {
    render(<CaptureSessionBanner captureCount={1} onProcess={vi.fn()} onCapture={vi.fn()} />);
    expect(screen.getByText(/1 capture ready to process/)).toBeInTheDocument();
  });

  it('"Add More" button calls onCapture', () => {
    const onCapture = vi.fn();
    render(<CaptureSessionBanner captureCount={2} onProcess={vi.fn()} onCapture={onCapture} />);
    fireEvent.click(screen.getByRole("button", { name: /add more/i }));
    expect(onCapture).toHaveBeenCalled();
  });

  it('"Process" button calls onProcess', () => {
    const onProcess = vi.fn();
    render(<CaptureSessionBanner captureCount={2} onProcess={onProcess} onCapture={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /process/i }));
    expect(onProcess).toHaveBeenCalled();
  });
});
