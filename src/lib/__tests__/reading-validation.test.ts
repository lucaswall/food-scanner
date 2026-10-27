import { describe, it, expect } from "vitest";
import {
  isValidReadingTimestamp,
  isPositiveIntUpTo,
  isPositiveNumberUpTo,
  parseReadingsRange,
  MAX_READINGS_RANGE_DAYS,
} from "@/lib/reading-validation";
import { parseFoodHistoryParams, parseStrictId } from "@/lib/food-history-params";

describe("isValidReadingTimestamp", () => {
  it.each([
    "2026-03-28T08:00:00Z",
    "2026-03-28T08:00:00.123Z",
    "2026-03-28T08:00:00.123456-03:00",
    "2024-02-29T00:00:00+00:00",
  ])("accepts %s", (value) => {
    expect(isValidReadingTimestamp(value)).toBe(true);
  });

  it.each([
    "2026-13-01T08:00:00Z",
    "2026-00-10T08:00:00Z",
    "2026-02-30T08:00:00Z",
    "2025-02-29T08:00:00Z",
    "2026-04-31T08:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T08:60:00Z",
    "2026-01-01T08:00:60Z",
    "2026-01-01T08:00:00+24:00",
    "2026-01-01T08:00:00+05:60",
    "1999-12-31T23:59:59Z",
    "2999-01-01T00:00:00Z",
    "2026-03-28 08:00:00Z",
    "2026-03-28T08:00:00",
    "not a date",
  ])("rejects %s", (value) => {
    expect(isValidReadingTimestamp(value)).toBe(false);
  });
});

describe("numeric bound helpers", () => {
  it("isPositiveIntUpTo accepts only integers in [1, max]", () => {
    expect(isPositiveIntUpTo(1, 300)).toBe(true);
    expect(isPositiveIntUpTo(300, 300)).toBe(true);
    expect(isPositiveIntUpTo(301, 300)).toBe(false);
    expect(isPositiveIntUpTo(0, 300)).toBe(false);
    expect(isPositiveIntUpTo(1.5, 300)).toBe(false);
    expect(isPositiveIntUpTo("5", 300)).toBe(false);
    expect(isPositiveIntUpTo(2147483648, 300)).toBe(false);
  });

  it("isPositiveNumberUpTo accepts finite numbers in (0, max]", () => {
    expect(isPositiveNumberUpTo(95.5, 2000)).toBe(true);
    expect(isPositiveNumberUpTo(2000, 2000)).toBe(true);
    expect(isPositiveNumberUpTo(2000.1, 2000)).toBe(false);
    expect(isPositiveNumberUpTo(0, 2000)).toBe(false);
    expect(isPositiveNumberUpTo(Infinity, 2000)).toBe(false);
    expect(isPositiveNumberUpTo(NaN, 2000)).toBe(false);
  });
});

describe("parseReadingsRange", () => {
  const parse = (query: string) => parseReadingsRange(new URLSearchParams(query));

  it("accepts a single date", () => {
    expect(parse("date=2026-03-01")).toEqual({ from: "2026-03-01", to: "2026-03-01" });
  });

  it("accepts a range of exactly MAX_READINGS_RANGE_DAYS days", () => {
    expect(MAX_READINGS_RANGE_DAYS).toBe(31);
    expect(parse("from=2026-03-01&to=2026-03-31")).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("rejects a range of MAX_READINGS_RANGE_DAYS + 1 days", () => {
    expect(parse("from=2026-03-01&to=2026-04-01")).toHaveProperty("error");
  });

  it("rejects calendar-invalid dates, reversed ranges and missing parameters", () => {
    expect(parse("date=2026-02-30")).toHaveProperty("error");
    expect(parse("from=2026-03-05&to=2026-03-01")).toHaveProperty("error");
    expect(parse("from=2026-03-05")).toHaveProperty("error");
    expect(parse("to=2026-03-05")).toHaveProperty("error");
    expect(parse("")).toHaveProperty("error");
  });
});

describe("parseStrictId", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["2147483647", 2147483647],
  ])("accepts %s", (value, expected) => {
    expect(parseStrictId(value)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "12abc", "0x10", "1e3", "2147483648", "99999999999", "", " 5", "+5"])(
    "rejects %j",
    (value) => {
      expect(parseStrictId(value)).toBeNull();
    },
  );
});

describe("parseFoodHistoryParams", () => {
  const parse = (query: string) => parseFoodHistoryParams(new URLSearchParams(query));

  it("returns no cursor and no endDate when nothing is provided", () => {
    expect(parse("")).toEqual({ endDate: undefined, cursor: undefined });
  });

  it("parses a full cursor", () => {
    expect(parse("endDate=2026-02-15&lastDate=2026-02-10&lastTime=08:00:00&lastId=5")).toEqual({
      endDate: "2026-02-15",
      cursor: { lastDate: "2026-02-10", lastTime: "08:00:00", lastId: 5 },
    });
  });

  it("allows a cursor without lastTime", () => {
    expect(parse("lastDate=2026-02-10&lastId=5")).toEqual({
      endDate: undefined,
      cursor: { lastDate: "2026-02-10", lastTime: null, lastId: 5 },
    });
  });

  it.each([
    "endDate=2026-13-45",
    "lastDate=2026-02-30&lastId=5",
    "lastDate=2026-02-10&lastId=5abc",
    "lastDate=2026-02-10&lastId=5&lastTime=24:00:00",
    "lastDate=2026-02-10",
    "lastId=5",
    "lastTime=08:00:00",
  ])("reports an error for %s", (query) => {
    expect(parse(query)).toHaveProperty("error");
  });
});
