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
  portion_size_g: 150,
  calories: 320,
  protein_g: 12,
  carbs_g: 28,
  fat_g: 18,
  fiber_g: 2,
  sodium_mg: 450,
  confidence: "high",
  notes: "Standard Argentine beef empanada, baked style",
};

describe("analyzeFood", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
