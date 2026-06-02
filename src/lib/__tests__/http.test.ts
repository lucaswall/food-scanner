import { describe, it, expect, vi, afterEach } from "vitest";
import { parseErrorBody, sanitizeErrorBody, jsonWithTimeout, REQUEST_TIMEOUT_MS } from "@/lib/http";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sanitizeErrorBody", () => {
  it("strips HTML tags from string bodies", () => {
    expect(sanitizeErrorBody("<p>oops <b>bad</b></p>")).toBe("oops bad");
  });
  it("truncates string bodies to 500 chars", () => {
    const long = "x".repeat(600);
    expect((sanitizeErrorBody(long) as string).length).toBe(500);
  });
  it("returns non-string bodies unchanged", () => {
    const obj = { error: "bad" };
    expect(sanitizeErrorBody(obj)).toBe(obj);
  });
});

describe("parseErrorBody", () => {
  it("parses JSON error body", async () => {
    const response = new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
    expect(await parseErrorBody(response)).toEqual({ error: "bad request" });
  });
  it("returns text when body is not JSON", async () => {
    const response = new Response("Not Found", { status: 404 });
    expect(await parseErrorBody(response)).toBe("Not Found");
  });
  it("returns fallback when body read fails", async () => {
    const response = new Response(null, { status: 500 });
    vi.spyOn(response, "text").mockRejectedValue(new Error("read failed"));
    expect(await parseErrorBody(response)).toBe("unable to read body");
  });
});

describe("jsonWithTimeout", () => {
  it("exposes REQUEST_TIMEOUT_MS = 10000", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(10000);
  });
  it("returns parsed JSON within timeout", async () => {
    const response = new Response(JSON.stringify({ foo: "bar" }), { status: 200 });
    expect(await jsonWithTimeout<{ foo: string }>(response)).toEqual({ foo: "bar" });
  });
  it("rejects when response.json() exceeds timeout", async () => {
    vi.useFakeTimers();
    const response = new Response(null, { status: 200 });
    vi.spyOn(response, "json").mockImplementation(() => new Promise(() => {})); // never resolves
    const promise = jsonWithTimeout(response, 5000);
    const rejection = expect(promise).rejects.toThrow("Response body read timed out");
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });
});
