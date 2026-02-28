import { describe, it, expect } from "vitest";
import { generateETag, etagMatches } from "@/lib/etag";

describe("generateETag", () => {
  it("returns a strong ETag in quoted format with 16 hex chars", () => {
    const etag = generateETag({ foo: "bar" });
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns same ETag for same data (deterministic)", () => {
    const data = { a: 1, b: "hello", c: [1, 2, 3] };
    expect(generateETag(data)).toBe(generateETag(data));
  });

  it("returns different ETag for different data", () => {
    expect(generateETag({ a: 1 })).not.toBe(generateETag({ a: 2 }));
  });

  it("handles null", () => {
    const etag = generateETag(null);
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("handles undefined", () => {
    const etag = generateETag(undefined);
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("handles empty object", () => {
    const etag = generateETag({});
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("handles empty array", () => {
    const etag = generateETag([]);
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("handles nested objects — same key order produces same ETag", () => {
    const a = { x: { y: 1, z: 2 }, w: "hello" };
    const b = { x: { y: 1, z: 2 }, w: "hello" };
    expect(generateETag(a)).toBe(generateETag(b));
  });

  it("produces different ETags for different key orders", () => {
    const a = { x: 1, y: 2 };
    const b = { y: 2, x: 1 };
    // JSON.stringify preserves insertion order, so these should differ
    expect(generateETag(a)).not.toBe(generateETag(b));
  });
});

describe("etagMatches", () => {
  it("returns false when ifNoneMatch is null", () => {
    expect(etagMatches(null, '"abc123"')).toBe(false);
  });

  it("returns true for exact match", () => {
    expect(etagMatches('"abc123"', '"abc123"')).toBe(true);
  });

  it("returns true for wildcard", () => {
    expect(etagMatches("*", '"anyvalue"')).toBe(true);
  });

  it("returns true when ETag is in a comma-separated list", () => {
    expect(etagMatches('"aaa", "bbb", "ccc"', '"bbb"')).toBe(true);
  });

  it("handles whitespace around commas", () => {
    expect(etagMatches('"aaa" , "bbb"', '"bbb"')).toBe(true);
  });

  it("returns false when no values match", () => {
    expect(etagMatches('"aaa", "bbb"', '"ccc"')).toBe(false);
  });

  it("handles weak ETag in If-None-Match matching strong stored ETag (weak comparison)", () => {
    // W/"abc" in If-None-Match should match "abc" stored ETag
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true);
  });

  it("handles strong ETag in If-None-Match matching weak stored ETag (weak comparison)", () => {
    // "abc" in If-None-Match should match W/"abc" stored ETag
    expect(etagMatches('"abc"', 'W/"abc"')).toBe(true);
  });
});
