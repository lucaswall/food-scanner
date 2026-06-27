import { describe, it, expect } from "vitest";
import { cn, isLikelyNetworkError } from "../utils";

describe("cn", () => {
  it("merges class names correctly", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conflicting Tailwind classes (twMerge behavior)", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("handles falsy values", () => {
    expect(cn("foo", false && "bar", undefined, null, "baz")).toBe("foo baz");
  });

  it("handles empty inputs", () => {
    expect(cn()).toBe("");
  });

  it("handles conditional classes", () => {
    const isActive = true;
    expect(cn("base", isActive && "active")).toBe("base active");
  });

  it("merges conflicting Tailwind text colors", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("keeps non-conflicting Tailwind classes", () => {
    expect(cn("p-4", "m-2")).toBe("p-4 m-2");
  });
});

describe("isLikelyNetworkError", () => {
  it("detects Safari 'Load failed' (FOOD-SCANNER-X)", () => {
    expect(isLikelyNetworkError(new TypeError("Load failed"))).toBe(true);
  });

  it("detects Chrome 'Failed to fetch'", () => {
    expect(isLikelyNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("detects Firefox 'NetworkError when attempting to fetch resource.'", () => {
    expect(
      isLikelyNetworkError(new TypeError("NetworkError when attempting to fetch resource.")),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isLikelyNetworkError(new TypeError("LOAD FAILED"))).toBe(true);
  });

  it("returns false for non-TypeError errors with matching text", () => {
    // Only fetch's TypeError signals a network failure; a generic Error with the
    // same words is an application error and must still reach Sentry.
    expect(isLikelyNetworkError(new Error("Load failed"))).toBe(false);
  });

  it("returns false for unrelated TypeErrors", () => {
    expect(isLikelyNetworkError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isLikelyNetworkError("Load failed")).toBe(false);
    expect(isLikelyNetworkError(null)).toBe(false);
    expect(isLikelyNetworkError(undefined)).toBe(false);
  });
});
