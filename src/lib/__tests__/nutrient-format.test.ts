import { describe, it, expect } from "vitest";
import { formatGrams, formatWhole } from "@/lib/nutrient-format";

describe("formatWhole", () => {
  it("rounds to an integer", () => {
    expect(formatWhole(180.4)).toBe("180");
    expect(formatWhole(180.6)).toBe("181");
    expect(formatWhole(0)).toBe("0");
  });
});

describe("formatGrams", () => {
  it("shows at most one decimal", () => {
    expect(formatGrams(12.34)).toBe("12.3");
    expect(formatGrams(0.1 + 0.2)).toBe("0.3");
  });

  it("drops trailing zeros", () => {
    expect(formatGrams(4)).toBe("4");
    expect(formatGrams(4.04)).toBe("4");
  });
});
