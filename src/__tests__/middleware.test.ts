import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

// Must import after mocks are set up
let middleware: (
  req: NextRequest,
) => ReturnType<(typeof import("../../middleware"))["middleware"]>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  // Re-setup mock after resetModules
  vi.doMock("@/lib/logger", () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    },
  }));

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

  it("redirects /settings to / with returnTo when unauthenticated", () => {
    const response = middleware(makeRequest("/settings"));
    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    const url = new URL(location);
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("returnTo")).toBe("/settings");
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
    expect(response.status).toBe(200);
  });

  it("passes through with valid session cookie on /settings", () => {
    const response = middleware(makeRequest("/settings", true));
    expect(response.status).toBe(200);
  });

  it("logs warn on unauthenticated API request", async () => {
    const mod = await import("@/lib/logger");
    middleware(makeRequest("/api/log-food"));
    expect(mod.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/log-food",
        action: "denied",
        reason: "missing_session",
      }),
      expect.any(String),
    );
  });

  it("logs warn on unauthenticated page request", async () => {
    const mod = await import("@/lib/logger");
    middleware(makeRequest("/app"));
    expect(mod.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/app",
        action: "redirect",
        reason: "missing_session",
      }),
      expect.any(String),
    );
  });

  it("logs debug on authenticated request", async () => {
    const mod = await import("@/lib/logger");
    middleware(makeRequest("/app", true));
    expect(mod.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/app",
        action: "allowed",
      }),
      expect.any(String),
    );
  });

  it("redirects /app when session cookie has empty value", () => {
    const url = new URL("/app", "http://localhost:3000");
    const req = new NextRequest(url);
    req.cookies.set("food-scanner-session", "");
    const response = middleware(req);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("redirects /app when session cookie has whitespace-only value", () => {
    const url = new URL("/app", "http://localhost:3000");
    const req = new NextRequest(url);
    req.cookies.set("food-scanner-session", "   ");
    const response = middleware(req);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("includes returnTo for /app/log-shared/abc when unauthenticated", () => {
    const response = middleware(makeRequest("/app/log-shared/abc"));
    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    expect(location).toContain("returnTo=");
    const url = new URL(location);
    expect(url.searchParams.get("returnTo")).toBe("/app/log-shared/abc");
  });

  it("does NOT include returnTo for /app (default destination)", () => {
    const response = middleware(makeRequest("/app"));
    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    expect(location).not.toContain("returnTo");
  });

  it("includes returnTo for nested /app routes like /app/history", () => {
    const response = middleware(makeRequest("/app/history"));
    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    const url = new URL(location);
    expect(url.searchParams.get("returnTo")).toBe("/app/history");
  });
});
