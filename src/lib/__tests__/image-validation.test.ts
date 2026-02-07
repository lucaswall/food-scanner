import { describe, it, expect } from "vitest";
import { isFileLike, MAX_IMAGES, MAX_IMAGE_SIZE, ALLOWED_TYPES } from "@/lib/image-validation";

describe("image-validation constants", () => {
  it("MAX_IMAGES is 3", () => {
    expect(MAX_IMAGES).toBe(3);
  });

  it("MAX_IMAGE_SIZE is 10MB", () => {
    expect(MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024);
  });

  it("ALLOWED_TYPES contains jpeg, png, gif, webp", () => {
    expect(ALLOWED_TYPES).toEqual(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  });
});

describe("isFileLike", () => {
  it("returns true for File-like objects", () => {
    const fileLike = {
      name: "test.jpg",
      type: "image/jpeg",
      size: 1000,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    };
    expect(isFileLike(fileLike)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isFileLike(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isFileLike(undefined)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isFileLike("not a file")).toBe(false);
  });

  it("returns false for number", () => {
    expect(isFileLike(42)).toBe(false);
  });

  it("returns false for object missing name", () => {
    const obj = {
      type: "image/jpeg",
      size: 1000,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    };
    expect(isFileLike(obj)).toBe(false);
  });

  it("returns false for object missing arrayBuffer method", () => {
    const obj = {
      name: "test.jpg",
      type: "image/jpeg",
      size: 1000,
    };
    expect(isFileLike(obj)).toBe(false);
  });
});
