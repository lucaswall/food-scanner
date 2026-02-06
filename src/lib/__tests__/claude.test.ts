import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FoodAnalysis } from "@/types";

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
      };
    },
  };
});

// Mock the logger
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");

const validAnalysis: FoodAnalysis = {
  food_name: "Empanada de carne",
  amount: 150,
  unit_id: 147,
  calories: 320,
  protein_g: 12,
  carbs_g: 28,
  fat_g: 18,
  fiber_g: 2,
  sodium_mg: 450,
  confidence: "high",
  notes: "Standard Argentine beef empanada, baked style",
  keywords: ["empanada", "carne", "horno"],
};

describe("analyzeFood", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns FoodAnalysis for valid tool_use response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result).toEqual(validAnalysis);
  });

  it("throws CLAUDE_API_ERROR on API failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API connection failed"));

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws CLAUDE_API_ERROR when no tool_use block in response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: "I cannot analyze this image",
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("passes correct system prompt and tool definition to Claude", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      "Test description"
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: expect.stringContaining("nutrition analyst"),
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "report_nutrition",
            input_schema: expect.objectContaining({
              type: "object",
              required: expect.arrayContaining([
                "food_name",
                "amount",
                "unit_id",
                "calories",
                "protein_g",
              ]),
            }),
          }),
        ]),
        tool_choice: { type: "tool", name: "report_nutrition" },
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image",
                source: expect.objectContaining({
                  type: "base64",
                  media_type: "image/jpeg",
                  data: "abc123",
                }),
              }),
              expect.objectContaining({
                type: "text",
                text: "Test description",
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it("returns amount and unit_id from Claude response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result.amount).toBe(150);
    expect(result.unit_id).toBe(147);
  });

  it("uses default text when no description provided", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: "Analyze this food.",
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it("supports multiple images", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood([
      { base64: "img1", mimeType: "image/jpeg" },
      { base64: "img2", mimeType: "image/png" },
    ]);

    const call = mockCreate.mock.calls[0][0];
    const imageBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[0].source.data).toBe("img1");
    expect(imageBlocks[1].source.data).toBe("img2");
  });

  it("retries once on timeout error", async () => {
    const timeoutError = new Error("Request timed out");
    timeoutError.name = "APIConnectionTimeoutError";

    mockCreate
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "tool_123",
            name: "report_nutrition",
            input: validAnalysis,
          },
        ],
      });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result).toEqual(validAnalysis);
  });

  it("throws after retry exhausted on timeout", async () => {
    const timeoutError = new Error("Request timed out");
    timeoutError.name = "APIConnectionTimeoutError";

    mockCreate
      .mockRejectedValueOnce(timeoutError)
      .mockRejectedValueOnce(timeoutError);

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("throws when tool_use output has missing fields", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: { food_name: "Test" }, // missing most fields
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when numeric fields are strings", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            calories: "320", // string instead of number
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when numeric fields are negative", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            calories: -10,
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("retries on rate limit (429) error", async () => {
    const rateLimitError = new Error("rate limit exceeded");
    rateLimitError.name = "RateLimitError";
    Object.assign(rateLimitError, { status: 429 });

    mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "tool_123",
            name: "report_nutrition",
            input: validAnalysis,
          },
        ],
      });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result).toEqual(validAnalysis);
  });

  it("throws after retry exhausted on persistent rate limit", async () => {
    const rateLimitError = new Error("rate limit exceeded");
    rateLimitError.name = "RateLimitError";
    Object.assign(rateLimitError, { status: 429 });

    mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError);

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("throws when confidence is not a valid enum value", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            confidence: "very_high",
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when validateFoodAnalysis input is null", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: null,
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when validateFoodAnalysis input is a string", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: "not an object",
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("returns properly typed FoodAnalysis with all fields", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    // Verify each field is explicitly present (not just a cast)
    expect(result.food_name).toBe("Empanada de carne");
    expect(result.amount).toBe(150);
    expect(result.unit_id).toBe(147);
    expect(result.calories).toBe(320);
    expect(result.protein_g).toBe(12);
    expect(result.carbs_g).toBe(28);
    expect(result.fat_g).toBe(18);
    expect(result.fiber_g).toBe(2);
    expect(result.sodium_mg).toBe(450);
    expect(result.confidence).toBe("high");
    expect(result.notes).toBe("Standard Argentine beef empanada, baked style");
  });

  it("isRateLimitError returns false for non-Error objects", async () => {
    // A non-Error with status 429 should not trigger rate limit retry
    mockCreate
      .mockRejectedValueOnce({ status: 429, message: "rate limited" })
      .mockRejectedValueOnce(new Error("second call should not happen"));

    const { analyzeFood } = await import("@/lib/claude");

    // Should throw without retrying since it's not an Error instance
    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });

    // Should only be called once (no retry for non-Error objects)
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("rate limited request retries with delay", { timeout: 20000 }, async () => {
    vi.useFakeTimers();

    const rateLimitError = new Error("rate limit exceeded");
    rateLimitError.name = "RateLimitError";
    Object.assign(rateLimitError, { status: 429 });

    mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "tool_123",
            name: "report_nutrition",
            input: validAnalysis,
          },
        ],
      });

    const { analyzeFood } = await import("@/lib/claude");
    const promise = analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    // The retry should wait for backoff delay (2^0 * 1000 = 1000ms)
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toEqual(validAnalysis);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("validates keywords array of strings in Claude response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result.keywords).toEqual(["empanada", "carne", "horno"]);
  });

  it("throws when keywords is not an array", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: "empanada",
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when keywords contains non-string values", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: ["empanada", 123, "carne"],
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when keywords is an empty array", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: [],
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("normalizes multi-word keywords by splitting on spaces", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: ["cerveza", "sin alcohol", "clausthaler"],
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result.keywords).toEqual(["cerveza", "sin-alcohol", "clausthaler"]);
  });

  it("trims and lowercases keywords", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: [" Cerveza ", "SIN-ALCOHOL"],
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result.keywords).toEqual(["cerveza", "sin-alcohol"]);
  });

  it("deduplicates keywords after normalization", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: ["cerveza", "cerveza", "sin-alcohol"],
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result.keywords).toEqual(["cerveza", "sin-alcohol"]);
  });

  it("caps keywords at 5 items keeping first 5", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: ["a", "b", "c", "d", "e", "f", "g"],
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result.keywords).toHaveLength(5);
  });

  it("removes empty keywords after trimming", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: ["cerveza", "", "  ", "sin-alcohol"],
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result.keywords).toEqual(["cerveza", "sin-alcohol"]);
  });

  it("includes keywords in tool schema required fields", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }]);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "report_nutrition",
            input_schema: expect.objectContaining({
              required: expect.arrayContaining(["keywords"]),
              properties: expect.objectContaining({
                keywords: expect.objectContaining({
                  type: "array",
                  items: { type: "string" },
                }),
              }),
            }),
          }),
        ]),
      })
    );
  });
});
