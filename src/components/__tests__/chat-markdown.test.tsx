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

  it("does NOT render images or their alt text", () => {
    const { container } = render(
      <ChatMarkdown content="![Alt text](https://example.com/image.png)" />
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.queryByText("Alt text")).not.toBeInTheDocument();
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

  it("wraps table in overflow-x-auto container for mobile scrolling", () => {
    const table = `| Name | Calories | Protein | Carbs | Fat |
| ---- | -------- | ------- | ----- | --- |
| Apple | 95 | 0.5 | 25 | 0.3 |
| Banana | 105 | 1.3 | 27 | 0.4 |`;
    const { container } = render(<ChatMarkdown content={table} />);
    const tableEl = container.querySelector("table");
    expect(tableEl).toBeInTheDocument();
    // Table must be wrapped in an overflow-x-auto container
    const wrapper = tableEl?.parentElement;
    expect(wrapper?.className).toContain("overflow-x-auto");
  });

  it("sanitizes javascript: protocol links", () => {
    const { container } = render(
      <ChatMarkdown content="[click me](javascript:alert('xss'))" />
    );
    const link = container.querySelector("a");
    expect(link).toBeInTheDocument();
    // href should be removed entirely (null) for unsafe protocols
    expect(link?.getAttribute("href")).toBeNull();
  });

  it("sanitizes data: protocol links", () => {
    const { container } = render(
      <ChatMarkdown content="[click me](data:text/html,<script>alert('xss')</script>)" />
    );
    const link = container.querySelector("a");
    expect(link).toBeInTheDocument();
    expect(link?.getAttribute("href")).toBeNull();
  });

  it("allows http: and https: protocol links", () => {
    const { container } = render(
      <ChatMarkdown content="[site](https://example.com) and [other](http://test.com)" />
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("https://example.com");
    expect(links[1].getAttribute("href")).toBe("http://test.com");
  });

  it("allows uppercase protocol links (HTTPS://, HTTP://)", () => {
    const { container } = render(
      <ChatMarkdown content="[site](HTTPS://example.com) and [other](HTTP://test.com)" />
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("HTTPS://example.com");
    expect(links[1].getAttribute("href")).toBe("HTTP://test.com");
  });

  it("allows mailto: protocol links", () => {
    const { container } = render(
      <ChatMarkdown content="[email](mailto:user@example.com)" />
    );
    const link = container.querySelector("a");
    expect(link).toBeInTheDocument();
    expect(link?.getAttribute("href")).toBe("mailto:user@example.com");
  });

  it("uses compact padding and text-xs on table cells", () => {
    const table = `| Name | Calories |
| ---- | -------- |
| Apple | 95 |`;
    const { container } = render(<ChatMarkdown content={table} />);
    const th = container.querySelector("th");
    const td = container.querySelector("td");
    expect(th?.className).toContain("px-1.5");
    expect(td?.className).toContain("px-1.5");
    expect(th?.className).toContain("text-xs");
    expect(td?.className).toContain("text-xs");
  });
});
