import { describe, it, expect } from "vitest";
import nextConfig from "../../../next.config";

describe("CSP header", () => {
  it("includes Content-Security-Policy in response headers", async () => {
    const headerGroups = await nextConfig.headers!();
    const globalHeaders = headerGroups.find(g => g.source === "/(.*)");
    const csp = globalHeaders?.headers.find(h => h.key === "Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp!.value).toContain("default-src 'self'");
    expect(csp!.value).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp!.value).toContain("img-src 'self' data: blob:");
  });
});
