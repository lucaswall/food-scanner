import { describe, it, expect } from "vitest";
import { confidenceColors, confidenceExplanations } from "../confidence";

describe("confidence", () => {
  describe("confidenceColors", () => {
    it("has entry for high confidence", () => {
      expect(confidenceColors.high).toBeDefined();
    });

    it("has entry for medium confidence", () => {
      expect(confidenceColors.medium).toBeDefined();
    });

    it("has entry for low confidence", () => {
      expect(confidenceColors.low).toBeDefined();
    });

    it("all color values are valid Tailwind bg classes", () => {
      for (const [, color] of Object.entries(confidenceColors)) {
        expect(color).toMatch(/^bg-\w+$/);
      }
    });

    it("high is success", () => {
      expect(confidenceColors.high).toBe("bg-success");
    });

    it("medium is warning", () => {
      expect(confidenceColors.medium).toBe("bg-warning");
    });

    it("low is destructive", () => {
      expect(confidenceColors.low).toBe("bg-destructive");
    });
  });

  describe("confidenceExplanations", () => {
    it("has entry for high confidence", () => {
      expect(confidenceExplanations.high).toBeDefined();
    });

    it("has entry for medium confidence", () => {
      expect(confidenceExplanations.medium).toBeDefined();
    });

    it("has entry for low confidence", () => {
      expect(confidenceExplanations.low).toBeDefined();
    });

    it("high explanation mentions certainty", () => {
      expect(confidenceExplanations.high).toMatch(/certain/i);
    });

    it("medium explanation mentions verification", () => {
      expect(confidenceExplanations.medium).toMatch(/verification|verify/i);
    });

    it("low explanation mentions uncertainty", () => {
      expect(confidenceExplanations.low).toMatch(/uncertain/i);
    });

    it("all explanations are non-empty strings", () => {
      for (const [, explanation] of Object.entries(confidenceExplanations)) {
        expect(typeof explanation).toBe("string");
        expect(explanation.length).toBeGreaterThan(0);
      }
    });
  });
});
