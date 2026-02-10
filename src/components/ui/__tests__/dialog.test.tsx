import { describe, it, expect } from "vitest";
import { dialogContentVariants } from "../dialog";

describe("DialogContent variant prop", () => {
  it("should render default variant with center positioning and zoom animation", () => {
    const classes = dialogContentVariants({ variant: "default" });

    // Default variant should have center positioning
    expect(classes).toContain("left-[50%]");
    expect(classes).toContain("top-[50%]");
    expect(classes).toContain("translate-x-[-50%]");
    expect(classes).toContain("translate-y-[-50%]");
    expect(classes).toContain("max-w-lg");

    // Default variant should have zoom animations
    expect(classes).toContain("zoom-out-95");
    expect(classes).toContain("zoom-in-95");

    // Default variant should have slide-from-top/left animations
    expect(classes).toContain("slide-out-to-left-1/2");
    expect(classes).toContain("slide-out-to-top-[48%]");
    expect(classes).toContain("slide-in-from-left-1/2");
    expect(classes).toContain("slide-in-from-top-[48%]");

    // Default variant should have rounded corners on sm screens
    expect(classes).toContain("sm:rounded-lg");
  });

  it("should render bottom-sheet variant with bottom positioning and slide-up animation", () => {
    const classes = dialogContentVariants({ variant: "bottom-sheet" });

    // Bottom-sheet should have bottom positioning with spacing
    expect(classes).toContain("bottom-4");
    expect(classes).toContain("left-0");
    expect(classes).toContain("right-0");
    expect(classes).toContain("top-auto");

    // Bottom-sheet should have slide-from-bottom animations
    expect(classes).toContain("slide-in-from-bottom");
    expect(classes).toContain("slide-out-to-bottom");

    // Bottom-sheet should have longer animation duration
    expect(classes).toContain("duration-300");

    // Bottom-sheet should have rounded top corners
    expect(classes).toContain("rounded-t-lg");

    // Bottom-sheet should NOT have center positioning or bottom-0
    expect(classes).not.toContain("left-[50%]");
    expect(classes).not.toContain("top-[50%]");
    expect(classes).not.toContain("translate-x-[-50%]");
    expect(classes).not.toContain("translate-y-[-50%]");
    expect(classes).not.toContain("max-w-lg");
    expect(classes).not.toContain("bottom-0");

    // Bottom-sheet should NOT have zoom animations
    expect(classes).not.toContain("zoom-out-95");
    expect(classes).not.toContain("zoom-in-95");

    // Bottom-sheet should NOT have slide-from-top/left animations
    expect(classes).not.toContain("slide-out-to-left-1/2");
    expect(classes).not.toContain("slide-out-to-top-[48%]");
    expect(classes).not.toContain("slide-in-from-left-1/2");
    expect(classes).not.toContain("slide-in-from-top-[48%]");

    // Bottom-sheet should NOT have sm:rounded-lg
    expect(classes).not.toContain("sm:rounded-lg");
  });

  it("should default to default variant when no variant prop is provided", () => {
    const classes = dialogContentVariants();

    // Should behave like default variant
    expect(classes).toContain("left-[50%]");
    expect(classes).toContain("zoom-in-95");
    expect(classes).toContain("translate-x-[-50%]");
    expect(classes).toContain("translate-y-[-50%]");
  });

  it("should apply bottom spacing to bottom-sheet variant", () => {
    const classes = dialogContentVariants({ variant: "bottom-sheet" });

    // Bottom-sheet should have bottom-4 for spacing
    expect(classes).toContain("bottom-4");
    expect(classes).not.toContain("bottom-0");
  });

  it("should apply longer animation duration to bottom-sheet variant", () => {
    const classes = dialogContentVariants({ variant: "bottom-sheet" });

    // Bottom-sheet should have duration-300 for smoother animation
    expect(classes).toContain("duration-300");
  });

  it("should apply default animation duration to default variant", () => {
    const classes = dialogContentVariants({ variant: "default" });

    // Default variant should have duration-200
    expect(classes).toContain("duration-200");
  });
});
