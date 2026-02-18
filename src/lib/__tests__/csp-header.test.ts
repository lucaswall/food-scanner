import { describe, it, expect, vi, afterEach } from "vitest";
import nextConfig from "../../../next.config";

describe("CSP header", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("includes Content-Security-Policy in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const headerGroups = await nextConfig.headers!();
    const globalHeaders = headerGroups.find(g => g.source === "/(.*)");
    const csp = globalHeaders?.headers.find(h => h.key === "Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp!.value).toContain("default-src 'self'");
    expect(csp!.value).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp!.value).toContain("img-src 'self' data: blob:");
    expect(csp!.value).toContain("connect-src 'self'");
    expect(csp!.value).toContain("frame-ancestors 'none'");
  });

  it("omits Content-Security-Policy in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const headerGroups = await nextConfig.headers!();
    const globalHeaders = headerGroups.find(g => g.source === "/(.*)");
    const csp = globalHeaders?.headers.find(h => h.key === "Content-Security-Policy");
    expect(csp).toBeUndefined();
  });
});
