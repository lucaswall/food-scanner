import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const source = readFileSync(resolve(__dirname, "../claude.ts"), "utf-8");

describe("Claude API retry configuration", () => {
  it("RETRY_DELAYS_MS has values [2000, 5000, 10000]", () => {
    const match = source.match(/RETRY_DELAYS_MS\s*=\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const values = match![1].split(",").map((v) => parseInt(v.trim(), 10));
    expect(values).toEqual([2000, 5000, 10000]);
  });

  it("createStreamWithRetry defaults to maxRetries = 3", () => {
    const allMatches = [...source.matchAll(/maxRetries\s*=\s*(\d+)/g)];
    // Find the one in the createStreamWithRetry function signature
    const funcMatch = allMatches.find((m) => {
      const before = source.substring(Math.max(0, m.index! - 200), m.index!);
      return before.includes("createStreamWithRetry");
    });
    expect(funcMatch).not.toBeUndefined();
    expect(parseInt(funcMatch![1], 10)).toBe(3);
  });

  it("fallback delay exists for out-of-bounds attempts", () => {
    expect(source).toContain("RETRY_DELAYS_MS[attempt] ?? ");
  });
});
