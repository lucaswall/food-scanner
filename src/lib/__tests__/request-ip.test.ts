import { describe, it, expect } from "vitest";
import { getClientIp } from "@/lib/request-ip";

describe("getClientIp", () => {
  it("returns the rightmost non-empty segment from X-Forwarded-For", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" });
    expect(getClientIp(headers)).toBe("9.9.9.9");
  });

  it("trims whitespace from each segment", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4 ,  5.6.7.8 ,  9.9.9.9 " });
    expect(getClientIp(headers)).toBe("9.9.9.9");
  });

  it("returns 'unknown' when X-Forwarded-For header is missing", () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");
  });

  it("returns 'unknown' when X-Forwarded-For is an empty string", () => {
    const headers = new Headers({ "x-forwarded-for": "" });
    expect(getClientIp(headers)).toBe("unknown");
  });

  it("returns 'unknown' when all segments are empty/whitespace", () => {
    const headers = new Headers({ "x-forwarded-for": " , , " });
    expect(getClientIp(headers)).toBe("unknown");
  });

  it("spoofed leftmost prefix does not affect rightmost (Railway-appended) IP", () => {
    const headers1 = new Headers({ "x-forwarded-for": "spoofed-1, real-ip" });
    const headers2 = new Headers({ "x-forwarded-for": "spoofed-2, real-ip" });
    expect(getClientIp(headers1)).toBe("real-ip");
    expect(getClientIp(headers2)).toBe("real-ip");
    // Both map to the same rate-limit key despite different spoofed prefixes
    expect(getClientIp(headers1)).toBe(getClientIp(headers2));
  });

  it("handles a single IP (no comma)", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4" });
    expect(getClientIp(headers)).toBe("1.2.3.4");
  });

  it("handles two IPs (client + Railway proxy)", () => {
    const headers = new Headers({ "x-forwarded-for": "10.0.0.1, 203.0.113.5" });
    expect(getClientIp(headers)).toBe("203.0.113.5");
  });
});
