import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DescriptionInput } from "../description-input";

// Mock useSpeechRecognition hook
const mockToggle = vi.fn();
const mockUseSpeechRecognition = vi.fn().mockReturnValue({
  isSupported: false,
  isListening: false,
  start: vi.fn(),
  stop: vi.fn(),
  toggle: mockToggle,
});

vi.mock("@/hooks/use-speech-recognition", () => ({
  useSpeechRecognition: (...args: unknown[]) => mockUseSpeechRecognition(...args),
}));

describe("DescriptionInput", () => {
  beforeEach(() => {
    mockToggle.mockClear();
    mockUseSpeechRecognition.mockClear();
    mockUseSpeechRecognition.mockReturnValue({
      isSupported: false,
      isListening: false,
      start: vi.fn(),
      stop: vi.fn(),
      toggle: mockToggle,
    });
  });

  it("renders textarea with placeholder", () => {
    const onChange = vi.fn();
    render(<DescriptionInput value="" onChange={onChange} />);

    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute(
      "placeholder",
      "e.g., 250g pollo asado con chimichurri"
    );
  });

  it("enforces 500 character limit", () => {
    const onChange = vi.fn();
    render(<DescriptionInput value="" onChange={onChange} />);

    const textarea = screen.getByRole("textbox");

    // Try to enter more than 500 characters
    const longText = "a".repeat(600);
    fireEvent.change(textarea, { target: { value: longText } });

    // onChange should be called with truncated text
    expect(onChange).toHaveBeenCalledWith("a".repeat(500));
  });

  it("shows character count", () => {
    const onChange = vi.fn();
    render(<DescriptionInput value="Hello world" onChange={onChange} />);

    // Should show character count
    expect(screen.getByText("11/500")).toBeInTheDocument();
  });

  it("shows character count at zero", () => {
    const onChange = vi.fn();
    render(<DescriptionInput value="" onChange={onChange} />);

    expect(screen.getByText("0/500")).toBeInTheDocument();
  });

  it("shows character count at limit", () => {
    const onChange = vi.fn();
    const maxText = "a".repeat(500);
    render(<DescriptionInput value={maxText} onChange={onChange} />);

    expect(screen.getByText("500/500")).toBeInTheDocument();
  });

  it("calls onChange with current value", () => {
    const onChange = vi.fn();
    render(<DescriptionInput value="" onChange={onChange} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Test input" } });

    expect(onChange).toHaveBeenCalledWith("Test input");
  });

  it("displays the provided value", () => {
    const onChange = vi.fn();
    render(
      <DescriptionInput value="Existing description" onChange={onChange} />
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue("Existing description");
  });

  it("has maxLength attribute set to 500", () => {
    const onChange = vi.fn();
    render(<DescriptionInput value="" onChange={onChange} />);

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveAttribute("maxLength", "500");
  });

  describe("mic button", () => {
    it("shows mic button when SpeechRecognition is supported", () => {
      mockUseSpeechRecognition.mockReturnValue({
        isSupported: true,
        isListening: false,
        start: vi.fn(),
        stop: vi.fn(),
        toggle: mockToggle,
      });

      render(<DescriptionInput value="" onChange={vi.fn()} />);

      const micButton = screen.getByRole("button", { name: /voice input/i });
      expect(micButton).toBeInTheDocument();
    });

    it("hides mic button when SpeechRecognition is not supported", () => {
      mockUseSpeechRecognition.mockReturnValue({
        isSupported: false,
        isListening: false,
        start: vi.fn(),
        stop: vi.fn(),
        toggle: mockToggle,
      });

      render(<DescriptionInput value="" onChange={vi.fn()} />);

      const micButton = screen.queryByRole("button", { name: /voice input/i });
      expect(micButton).not.toBeInTheDocument();
    });

    it("calls toggle when mic button clicked", () => {
      mockUseSpeechRecognition.mockReturnValue({
        isSupported: true,
        isListening: false,
        start: vi.fn(),
        stop: vi.fn(),
        toggle: mockToggle,
      });

      render(<DescriptionInput value="" onChange={vi.fn()} />);

      const micButton = screen.getByRole("button", { name: /voice input/i });
      fireEvent.click(micButton);

      expect(mockToggle).toHaveBeenCalled();
    });

    it("shows listening indicator when isListening is true", () => {
      mockUseSpeechRecognition.mockReturnValue({
        isSupported: true,
        isListening: true,
        start: vi.fn(),
        stop: vi.fn(),
        toggle: mockToggle,
      });

      render(<DescriptionInput value="" onChange={vi.fn()} />);

      const micButton = screen.getByRole("button", { name: /stop voice input/i });
      expect(micButton).toBeInTheDocument();
    });

    it("disables mic button when disabled prop is true", () => {
      mockUseSpeechRecognition.mockReturnValue({
        isSupported: true,
        isListening: false,
        start: vi.fn(),
        stop: vi.fn(),
        toggle: mockToggle,
      });

      render(<DescriptionInput value="" onChange={vi.fn()} disabled />);

      const micButton = screen.getByRole("button", { name: /voice input/i });
      expect(micButton).toBeDisabled();
    });

    it("appends transcript to existing value with space separator", () => {
      let capturedOnResult: ((text: string) => void) | undefined;
      mockUseSpeechRecognition.mockImplementation(({ onResult }: { onResult: (text: string) => void }) => {
        capturedOnResult = onResult;
        return {
          isSupported: true,
          isListening: false,
          start: vi.fn(),
          stop: vi.fn(),
          toggle: mockToggle,
        };
      });

      const onChange = vi.fn();
      render(<DescriptionInput value="existing text" onChange={onChange} />);

      // Simulate transcript received
      capturedOnResult?.("new words");

      expect(onChange).toHaveBeenCalledWith("existing text new words");
    });

    it("appends transcript without extra space when value is empty", () => {
      let capturedOnResult: ((text: string) => void) | undefined;
      mockUseSpeechRecognition.mockImplementation(({ onResult }: { onResult: (text: string) => void }) => {
        capturedOnResult = onResult;
        return {
          isSupported: true,
          isListening: false,
          start: vi.fn(),
          stop: vi.fn(),
          toggle: mockToggle,
        };
      });

      const onChange = vi.fn();
      render(<DescriptionInput value="" onChange={onChange} />);

      capturedOnResult?.("new words");

      expect(onChange).toHaveBeenCalledWith("new words");
    });

    it("appends transcript without extra space when value ends with space", () => {
      let capturedOnResult: ((text: string) => void) | undefined;
      mockUseSpeechRecognition.mockImplementation(({ onResult }: { onResult: (text: string) => void }) => {
        capturedOnResult = onResult;
        return {
          isSupported: true,
          isListening: false,
          start: vi.fn(),
          stop: vi.fn(),
          toggle: mockToggle,
        };
      });

      const onChange = vi.fn();
      render(<DescriptionInput value="existing " onChange={onChange} />);

      capturedOnResult?.("new words");

      expect(onChange).toHaveBeenCalledWith("existing new words");
    });
  });
});
