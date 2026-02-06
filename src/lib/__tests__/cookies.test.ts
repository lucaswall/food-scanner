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
});
