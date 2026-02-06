import { describe, it, expect } from "vitest";
import { getCookieValue } from "@/lib/cookies";

describe("getCookieValue", () => {
  it("returns value when cookie exists", () => {
    const request = new Request("http://localhost", {
      headers: { cookie: "name=value" },
    });
    expect(getCookieValue(request, "name")).toBe("value");
  });

  it("returns undefined when cookie is missing", () => {
    const request = new Request("http://localhost", {
      headers: { cookie: "other=value" },
    });
    expect(getCookieValue(request, "name")).toBeUndefined();
  });

  it("handles multiple cookies", () => {
    const request = new Request("http://localhost", {
      headers: { cookie: "first=one; second=two; third=three" },
    });
    expect(getCookieValue(request, "second")).toBe("two");
  });

  it("handles empty cookie header", () => {
    const request = new Request("http://localhost");
    expect(getCookieValue(request, "name")).toBeUndefined();
  });

  it("correctly handles cookie names with dot (regex metacharacter)", () => {
    // "my.cookie" should NOT match "myXcookie" (dot is a regex wildcard)
    const request = new Request("http://localhost", {
      headers: { cookie: "myXcookie=wrong; my.cookie=correct" },
    });
    expect(getCookieValue(request, "my.cookie")).toBe("correct");
  });

  it("correctly handles cookie names with plus sign", () => {
    const request = new Request("http://localhost", {
      headers: { cookie: "a+b=value" },
    });
    expect(getCookieValue(request, "a+b")).toBe("value");
  });

  it("returns first match when multiple same-name cookies present", () => {
    const request = new Request("http://localhost", {
      headers: { cookie: "token=first; other=x; token=second" },
    });
    expect(getCookieValue(request, "token")).toBe("first");
  });
});
