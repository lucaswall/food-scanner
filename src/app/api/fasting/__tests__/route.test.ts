import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, FastingWindow } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (
    session: FullSession | null,
    options?: { requireFitbit?: boolean },
  ): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      );
    }
    if (options?.requireFitbit && !session.fitbitConnected) {
      return Response.json(
        { success: false, error: { code: "FITBIT_NOT_CONNECTED", message: "Fitbit account not connected" }, timestamp: Date.now() },
        { status: 400 },
      );
    }
    if (options?.requireFitbit && !session.hasFitbitCredentials) {
      return Response.json(
        { success: false, error: { code: "FITBIT_CREDENTIALS_MISSING", message: "Fitbit credentials not configured" }, timestamp: Date.now() },
        { status: 400 },
      );
    }
    return null;
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetFastingWindow = vi.fn();
const mockGetFastingWindows = vi.fn();
vi.mock("@/lib/fasting", () => ({
  getFastingWindow: (...args: unknown[]) => mockGetFastingWindow(...args),
  getFastingWindows: (...args: unknown[]) => mockGetFastingWindows(...args),
}));

// Mock date-utils to control "today"
vi.mock("@/lib/date-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date-utils")>();
  return {
    ...actual,
    isToday: (dateStr: string) => dateStr === "2026-02-12",
  };
});

const { GET } = await import("@/app/api/fasting/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

function createRequest(url: string): Request {
  return new Request(url);
}

describe("GET /api/fasting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when session is missing", async () => {
    mockGetSession.mockResolvedValue(null);

    const req = createRequest("http://localhost:3000/api/fasting?date=2026-02-12");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 when date parameter is missing", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const req = createRequest("http://localhost:3000/api/fasting");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toContain("date");
  });

  it("returns 400 when date format is invalid", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const req = createRequest("http://localhost:3000/api/fasting?date=2026-13-01");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toContain("Invalid date format");
  });

  it("returns completed fasting window for past date", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockWindow: FastingWindow = {
      date: "2026-02-11",
      lastMealTime: "21:00:00",
      firstMealTime: "09:00:00",
      durationMinutes: 720,
    };
    mockGetFastingWindow.mockResolvedValue(mockWindow);

    const req = createRequest("http://localhost:3000/api/fasting?date=2026-02-11");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({
      window: mockWindow,
      live: null,
    });
    expect(mockGetFastingWindow).toHaveBeenCalledWith("user-uuid-123", "2026-02-11");
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns live mode for today with ongoing fast", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockWindow: FastingWindow = {
      date: "2026-02-12",
      lastMealTime: "20:00:00",
      firstMealTime: null,
      durationMinutes: null,
    };
    mockGetFastingWindow.mockResolvedValue(mockWindow);

    const req = createRequest("http://localhost:3000/api/fasting?date=2026-02-12");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({
      window: mockWindow,
      live: {
        lastMealTime: "20:00:00",
        startDate: "2026-02-11", // Previous day since lastMealTime is from yesterday
      },
    });
  });

  it("returns no live mode for today with completed fast", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockWindow: FastingWindow = {
      date: "2026-02-12",
      lastMealTime: "20:00:00",
      firstMealTime: "10:00:00",
      durationMinutes: 840,
    };
    mockGetFastingWindow.mockResolvedValue(mockWindow);

    const req = createRequest("http://localhost:3000/api/fasting?date=2026-02-12");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({
      window: mockWindow,
      live: null,
    });
  });

  it("returns null window when no previous day meal", async () => {
    mockGetSession.mockResolvedValue(validSession);

    mockGetFastingWindow.mockResolvedValue(null);

    const req = createRequest("http://localhost:3000/api/fasting?date=2026-02-12");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({
      window: null,
      live: null,
    });
  });

  it("returns 400 when from is missing but to is provided", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const req = createRequest("http://localhost:3000/api/fasting?to=2026-02-13");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toContain("Both from and to");
  });

  it("returns 400 when to is missing but from is provided", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const req = createRequest("http://localhost:3000/api/fasting?from=2026-02-11");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toContain("Both from and to");
  });

  it("returns 400 when from date format is invalid", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const req = createRequest("http://localhost:3000/api/fasting?from=invalid&to=2026-02-13");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns fasting windows for date range", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockWindows: FastingWindow[] = [
      {
        date: "2026-02-11",
        lastMealTime: "20:00:00",
        firstMealTime: "10:00:00",
        durationMinutes: 840,
      },
      {
        date: "2026-02-12",
        lastMealTime: "21:00:00",
        firstMealTime: "09:00:00",
        durationMinutes: 720,
      },
      {
        date: "2026-02-13",
        lastMealTime: "22:00:00",
        firstMealTime: "08:00:00",
        durationMinutes: 600,
      },
    ];
    mockGetFastingWindows.mockResolvedValue(mockWindows);

    const req = createRequest("http://localhost:3000/api/fasting?from=2026-02-11&to=2026-02-13");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({
      windows: mockWindows,
    });
    expect(mockGetFastingWindows).toHaveBeenCalledWith("user-uuid-123", "2026-02-11", "2026-02-13");
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 500 when getFastingWindow throws error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFastingWindow.mockRejectedValue(new Error("Database error"));

    const req = createRequest("http://localhost:3000/api/fasting?date=2026-02-12");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns 500 when getFastingWindows throws error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFastingWindows.mockRejectedValue(new Error("Database error"));

    const req = createRequest("http://localhost:3000/api/fasting?from=2026-02-11&to=2026-02-13");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});
