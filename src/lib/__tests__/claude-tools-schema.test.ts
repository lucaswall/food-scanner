import { describe, it, expect } from "vitest";
import { REPORT_NUTRITION_TOOL } from "@/lib/claude-tools-schema";

// FOO-1157: Core numeric fields of REPORT_NUTRITION_TOOL must have descriptions
// so Claude understands the expected values and units.
describe("REPORT_NUTRITION_TOOL schema — numeric field descriptions", () => {
  const props = REPORT_NUTRITION_TOOL.input_schema.properties as Record<string, { type: string; description?: string }>;

  const numericFields = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sodium_mg"] as const;

  for (const field of numericFields) {
    it(`${field} has a non-empty description`, () => {
      expect(props[field]).toBeDefined();
      expect(typeof props[field].description).toBe("string");
      expect((props[field].description as string).length).toBeGreaterThan(0);
    });
  }
});
