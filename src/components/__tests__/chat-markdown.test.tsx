import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMarkdown } from "../chat-markdown";

describe("ChatMarkdown", () => {
  it("renders plain text as-is", () => {
    render(<ChatMarkdown content="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders **bold** as a <strong> element", async () => {
    const { container } = render(<ChatMarkdown content="This is **bold** text" />);
    const strong = container.querySelector("strong");
    expect(strong).toBeInTheDocument();
    expect(strong?.textContent).toBe("bold");
  });

  it("renders pipe-delimited tables as <table> elements (remark-gfm)", async () => {
    const table = `| Name | Calories |
| ---- | -------- |
| Apple | 95 |`;
    const { container } = render(<ChatMarkdown content={table} />);
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelector("th")).toBeInTheDocument();
    expect(container.querySelector("td")).toBeInTheDocument();
  });

  it("renders numbered lists as <ol> elements", async () => {
    const list = `1. First item
2. Second item
3. Third item`;
    const { container } = render(<ChatMarkdown content={list} />);
    const ol = container.querySelector("ol");
    expect(ol).toBeInTheDocument();
    const items = ol?.querySelectorAll("li");
    expect(items?.length).toBe(3);
  });

  it("does NOT render images", () => {
    const { container } = render(
      <ChatMarkdown content="![Alt text](https://example.com/image.png)" />
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("does NOT render h1 headings", () => {
    const { container } = render(<ChatMarkdown content="# Big Heading" />);
    expect(container.querySelector("h1")).not.toBeInTheDocument();
  });

  it("does NOT render h2-h6 headings", () => {
    const { container } = render(
      <ChatMarkdown
        content={`## H2
### H3
#### H4
##### H5
###### H6`}
      />
    );
    for (let i = 2; i <= 6; i++) {
      expect(container.querySelector(`h${i}`)).not.toBeInTheDocument();
    }
  });

  it("applies text-sm class to the wrapper", () => {
    const { container } = render(<ChatMarkdown content="Some text" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("text-sm");
  });
});
