import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DescriptionInput } from "../description-input";

describe("DescriptionInput", () => {
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

    const longText = "a".repeat(600);
    fireEvent.change(textarea, { target: { value: longText } });

    expect(onChange).toHaveBeenCalledWith("a".repeat(500));
  });

  it("shows character count", () => {
    const onChange = vi.fn();
    render(<DescriptionInput value="Hello world" onChange={onChange} />);

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

  it("has aria-label for accessibility", () => {
    const onChange = vi.fn();
    render(<DescriptionInput value="" onChange={onChange} />);

    expect(screen.getByRole("textbox", { name: /food description/i })).toBeInTheDocument();
  });

  describe("visible label", () => {
    it("renders a visible label with text 'Food description (optional)'", () => {
      const onChange = vi.fn();
      render(<DescriptionInput value="" onChange={onChange} />);

      const label = screen.getByText(/food description.*optional/i);
      expect(label.tagName).toBe("LABEL");
    });

    it("label has htmlFor='food-description' and textarea has matching id", () => {
      const onChange = vi.fn();
      render(<DescriptionInput value="" onChange={onChange} />);

      const label = screen.getByText(/food description.*optional/i, { selector: "label" });
      expect(label).toHaveAttribute("for", "food-description");

      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveAttribute("id", "food-description");
    });

    it("textarea is accessible via label association", () => {
      const onChange = vi.fn();
      render(<DescriptionInput value="" onChange={onChange} />);

      // Should be able to find textarea by its associated label text
      const textarea = screen.getByRole("textbox", { name: /food description.*optional/i });
      expect(textarea).toBeInTheDocument();
    });
  });
});
