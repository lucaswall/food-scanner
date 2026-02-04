import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const { GET } = await import("@/app/api/health/route");
const { logger } = await import("@/lib/logger");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("returns success with status ok", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
  });

  it("logs debug on health check", async () => {
    await GET();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: "health_check" }),
      expect.any(String),
    );
  });
});
