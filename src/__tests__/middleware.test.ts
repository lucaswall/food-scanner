import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Must import after mocks are set up
let middleware: (req: NextRequest) => ReturnType<typeof import("../../middleware").middleware>;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../../middleware");
  middleware = mod.middleware;
});

function makeRequest(path: string, hasCookie = false): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  const req = new NextRequest(url);
  if (hasCookie) {
    req.cookies.set("food-scanner-session", "encrypted-session-value");
  }
  return req;
}

describe("middleware", () => {
  it("redirects /app to / without session cookie", () => {
    const response = middleware(makeRequest("/app"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("redirects /settings to / without session cookie", () => {
    const response = middleware(makeRequest("/settings"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("returns 401 JSON for /api/log-food without session cookie", async () => {
    const response = middleware(makeRequest("/api/log-food"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("passes through with valid session cookie on /app", () => {
    const response = middleware(makeRequest("/app", true));
    // NextResponse.next() returns a 200
    expect(response.status).toBe(200);
  });

  it("passes through with valid session cookie on /settings", () => {
    const response = middleware(makeRequest("/settings", true));
    expect(response.status).toBe(200);
  });
});
