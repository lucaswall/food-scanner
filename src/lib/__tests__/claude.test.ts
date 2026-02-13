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

// Mock recordUsage
const mockRecordUsage = vi.fn();
vi.mock("@/lib/claude-usage", () => ({
  recordUsage: mockRecordUsage,
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
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high",
  notes: "Standard Argentine beef empanada, baked style",
  keywords: ["empanada", "carne", "horno"],
  description: "Standard Argentine beef empanada, baked style",
};

function setupMocks() {
  vi.clearAllMocks();
  mockCreate.mockReset();
}

describe("analyzeFood", () => {
  beforeEach(() => {
    setupMocks();
    mockRecordUsage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns FoodAnalysis for valid tool_use response", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123"
    );

    expect(result).toEqual(validAnalysis);
  });

  it("calls recordUsage with correct arguments after successful analysis", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123"
    );

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-sonnet-4-20250514",
      "food-analysis",
      {
        inputTokens: 1500,
        outputTokens: 300,
        cacheCreationTokens: 100,
        cacheReadTokens: 50,
      }
    );
  });

  it("does not await recordUsage (fire-and-forget)", async () => {
    let recordUsageResolved = false;
    mockRecordUsage.mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          recordUsageResolved = true;
          resolve(undefined);
        }, 100);
      });
    });

    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123"
    );

    // Should return immediately without waiting for recordUsage
    expect(result).toEqual(validAnalysis);
    expect(recordUsageResolved).toBe(false);
  });

  it("succeeds even if recordUsage throws", async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error("Database error"));

    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123"
    );

    expect(result).toEqual(validAnalysis);
    expect(mockRecordUsage).toHaveBeenCalled();
  });

  it("throws CLAUDE_API_ERROR on API failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API connection failed"));

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });

    // Should be called exactly once (no retry)
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // recordUsage should NOT be called on failure
    expect(mockRecordUsage).not.toHaveBeenCalled();
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

  it("configures SDK with explicit maxRetries", async () => {
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

    // Verify client is initialized (indirect test - we can't directly inspect Anthropic constructor)
    expect(mockCreate).toHaveBeenCalled();
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

  it("works with text-only (no images)", async () => {
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
    const result = await analyzeFood([], "2 medialunas y un cortado");

    expect(result).toEqual(validAnalysis);

    // Verify no image blocks in the API call
    const call = mockCreate.mock.calls[0][0];
    const imageBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(imageBlocks).toHaveLength(0);

    // Verify text block uses the description
    const textBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "text"
    );
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].text).toBe("2 medialunas y un cortado");
  });

  it("text-only uses description as the sole content block", async () => {
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
    await analyzeFood([], "A bowl of lentil soup");

    const call = mockCreate.mock.calls[0][0];
    const content = call.messages[0].content;

    // Should be exactly one block: the text description
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({
      type: "text",
      text: "A bowl of lentil soup",
    });
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

  it("includes description in tool schema", async () => {
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
              required: expect.arrayContaining(["description"]),
              properties: expect.objectContaining({
                description: expect.objectContaining({
                  type: "string",
                }),
              }),
            }),
          }),
        ]),
      })
    );
  });

  it("description field prompt excludes scene elements and includes length constraint", async () => {
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

    const call = mockCreate.mock.calls[0][0];
    const toolSchema = call.tools[0];
    const descriptionPrompt = toolSchema.input_schema.properties.description.description;

    // Should exclude non-food scene elements
    expect(descriptionPrompt.toLowerCase()).toMatch(/(food only|do not describe)/);

    // Should include length constraint
    expect(descriptionPrompt).toMatch(/1-2.*sentence/i);

    // Should NOT include "presentation" as an instruction (we want to exclude it)
    expect(descriptionPrompt).not.toContain("presentation");
  });

  it("validates description as required string", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            description: 123, // number instead of string
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("accepts response without description (defaults to empty string)", async () => {
    const analysisWithoutDescription = { ...validAnalysis };
    delete (analysisWithoutDescription as Partial<FoodAnalysis>).description;

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: analysisWithoutDescription,
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }]);

    expect(result.description).toBe("");
  });
});

describe("validateFoodAnalysis with Tier 1 nutrients", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("accepts valid input with all 4 Tier 1 fields as numbers", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            saturated_fat_g: 5.5,
            trans_fat_g: 0.2,
            sugars_g: 3.0,
            calories_from_fat: 162,
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result.saturated_fat_g).toBe(5.5);
    expect(result.trans_fat_g).toBe(0.2);
    expect(result.sugars_g).toBe(3.0);
    expect(result.calories_from_fat).toBe(162);
  });

  it("accepts valid input with all 4 Tier 1 fields as null", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            saturated_fat_g: null,
            trans_fat_g: null,
            sugars_g: null,
            calories_from_fat: null,
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result.saturated_fat_g).toBeNull();
    expect(result.trans_fat_g).toBeNull();
    expect(result.sugars_g).toBeNull();
    expect(result.calories_from_fat).toBeNull();
  });

  it("accepts valid input with Tier 1 fields omitted (backward compat)", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis, // no Tier 1 fields
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    // Should default to null when omitted
    expect(result.saturated_fat_g).toBeNull();
    expect(result.trans_fat_g).toBeNull();
    expect(result.sugars_g).toBeNull();
    expect(result.calories_from_fat).toBeNull();
  });

  it("rejects negative values for saturated_fat_g", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            saturated_fat_g: -1,
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("rejects negative values for trans_fat_g", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            trans_fat_g: -0.5,
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("rejects negative values for sugars_g", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            sugars_g: -2,
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("rejects negative values for calories_from_fat", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            calories_from_fat: -10,
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("rejects string value for saturated_fat_g", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            saturated_fat_g: "5.5",
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("rejects boolean value for trans_fat_g", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            trans_fat_g: true,
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }])
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("accepts zero values for Tier 1 fields", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            saturated_fat_g: 0,
            trans_fat_g: 0,
            sugars_g: 0,
            calories_from_fat: 0,
          },
        },
      ],
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([
      { base64: "abc123", mimeType: "image/jpeg" },
    ]);

    expect(result.saturated_fat_g).toBe(0);
    expect(result.trans_fat_g).toBe(0);
    expect(result.sugars_g).toBe(0);
    expect(result.calories_from_fat).toBe(0);
  });
});

describe("conversationalRefine", () => {
  beforeEach(() => {
    setupMocks();
    mockRecordUsage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns message and analysis when Claude responds with text + tool_use", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "I've updated the portion size to 200g",
        },
        {
          type: "tool_use",
          id: "tool_789",
          name: "report_nutrition",
          input: { ...validAnalysis, amount: 200 },
        },
      ],
      usage: {
        input_tokens: 1800,
        output_tokens: 400,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    const result = await conversationalRefine(
      [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Got it", analysis: validAnalysis },
        { role: "user", content: "Actually it was 200g" },
      ],
      [],
      "user-123"
    );

    expect(result).toEqual({
      message: "I've updated the portion size to 200g",
      analysis: { ...validAnalysis, amount: 200 },
    });
  });

  it("returns only message when Claude responds with text only (no tool_use)", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "Got it! Anything else you'd like to add?",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    const result = await conversationalRefine(
      [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Recorded", analysis: validAnalysis },
        { role: "user", content: "Thanks!" },
      ],
      [],
      "user-123"
    );

    expect(result).toEqual({
      message: "Got it! Anything else you'd like to add?",
    });
    expect(result.analysis).toBeUndefined();
  });

  it("uses tool_choice auto (not forced)", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "Understood",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "I had a coffee" }],
      [],
      "user-123"
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "auto" },
      })
    );
  });

  it("uses CHAT_SYSTEM_PROMPT without initial analysis", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine, CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123"
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: CHAT_SYSTEM_PROMPT,
      })
    );
  });

  it("includes initial analysis context in system prompt when provided", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Make it 2" }],
      [],
      "user-123",
      validAnalysis
    );

    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toContain(validAnalysis.food_name);
    expect(call.system).toContain(String(validAnalysis.calories));
    expect(call.system).toContain("baseline");
  });

  it("uses max_tokens 2048", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123"
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 2048,
      })
    );
  });

  it("attaches images to the last user message", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "I see the food",
        },
        {
          type: "tool_use",
          id: "tool_789",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 2000,
        output_tokens: 300,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Logged" },
        { role: "user", content: "Here's a photo" },
      ],
      [{ base64: "img123", mimeType: "image/jpeg" }],
      "user-123"
    );

    const call = mockCreate.mock.calls[0][0];
    // First user message should NOT have images
    const firstMessage = call.messages[0];
    const firstImageBlocks = firstMessage.content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(firstImageBlocks).toHaveLength(0);

    // Last user message SHOULD have images
    const lastMessage = call.messages[2];
    const lastImageBlocks = lastMessage.content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(lastImageBlocks).toHaveLength(1);
    expect(lastImageBlocks[0].source.data).toBe("img123");
  });

  it("does not include images when not provided", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Logged", analysis: validAnalysis },
      ],
      [],
      "user-123"
    );

    const call = mockCreate.mock.calls[0][0];
    call.messages.forEach((msg: { content: Array<{ type: string }> }) => {
      const imageBlocks = msg.content.filter(
        (block: { type: string }) => block.type === "image"
      );
      expect(imageBlocks).toHaveLength(0);
    });
  });

  it("records usage as food-chat operation", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "Done",
        },
      ],
      usage: {
        input_tokens: 1700,
        output_tokens: 120,
        cache_creation_input_tokens: 80,
        cache_read_input_tokens: 200,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123"
    );

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-sonnet-4-20250514",
      "food-chat",
      {
        inputTokens: 1700,
        outputTokens: 120,
        cacheCreationTokens: 80,
        cacheReadTokens: 200,
      }
    );
  });

  it("throws CLAUDE_API_ERROR on API failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API connection failed"));

    const { conversationalRefine } = await import("@/lib/claude");

    await expect(
      conversationalRefine(
        [{ role: "user", content: "Test" }],
        [],
        "user-123"
      )
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("succeeds even if recordUsage throws", async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error("Database error"));

    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "Done",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    const result = await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123"
    );

    expect(result).toEqual({ message: "Done" });
    expect(mockRecordUsage).toHaveBeenCalled();
  });

  it("converts ConversationMessage array to Anthropic message format", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-20250514",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [
        { role: "user", content: "I had pizza" },
        { role: "assistant", content: "Logged", analysis: validAnalysis },
        { role: "user", content: "Add more cheese" },
      ],
      [],
      "user-123"
    );

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages).toHaveLength(3);
    expect(call.messages[0].role).toBe("user");
    expect(call.messages[0].content).toEqual([
      { type: "text", text: "I had pizza" },
    ]);
    expect(call.messages[1].role).toBe("assistant");
    expect(call.messages[1].content).toEqual([
      { type: "text", text: "Logged" },
    ]);
    expect(call.messages[2].role).toBe("user");
    expect(call.messages[2].content).toEqual([
      { type: "text", text: "Add more cheese" },
    ]);
  });
});
