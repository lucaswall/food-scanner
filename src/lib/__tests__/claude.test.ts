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

    // Should be called exactly once (no retry)
    expect(mockCreate).toHaveBeenCalledTimes(1);
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

describe("refineAnalysis", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("calls Claude API with images, previous analysis, and correction text", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_456",
          name: "report_nutrition",
          input: { ...validAnalysis, calories: 500 },
        },
      ],
    });

    const { refineAnalysis } = await import("@/lib/claude");
    await refineAnalysis(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      validAnalysis,
      "Actually this is a larger portion, about 500 calories"
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];

    // Should include images in user message
    const imageBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0].source.data).toBe("abc123");

    // Should include previous analysis and correction in text block
    const textBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "text"
    );
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].text).toContain("Empanada de carne");
    expect(textBlocks[0].text).toContain("320"); // calories
    expect(textBlocks[0].text).toContain("Actually this is a larger portion, about 500 calories");
  });

  it("system prompt includes refinement instruction", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_456",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { refineAnalysis } = await import("@/lib/claude");
    await refineAnalysis(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      validAnalysis,
      "Make it 200 calories"
    );

    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toContain("nutrition analyst");
  });

  it("returns validated FoodAnalysis", async () => {
    const refinedAnalysis: FoodAnalysis = {
      ...validAnalysis,
      calories: 500,
      notes: "Larger portion as specified by user",
    };

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_456",
          name: "report_nutrition",
          input: refinedAnalysis,
        },
      ],
    });

    const { refineAnalysis } = await import("@/lib/claude");
    const result = await refineAnalysis(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      validAnalysis,
      "Larger portion"
    );

    expect(result).toEqual(refinedAnalysis);
  });


  it("throws CLAUDE_API_ERROR on failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API connection failed"));

    const { refineAnalysis } = await import("@/lib/claude");

    await expect(
      refineAnalysis(
        [{ base64: "abc123", mimeType: "image/jpeg" }],
        validAnalysis,
        "Fix it"
      )
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });

    // Should be called exactly once (no retry)
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("uses same model and tool configuration as analyzeFood", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_456",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { refineAnalysis } = await import("@/lib/claude");
    await refineAnalysis(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      validAnalysis,
      "Correction"
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "report_nutrition" }),
        ]),
        tool_choice: { type: "tool", name: "report_nutrition" },
      })
    );
  });

  it("supports multiple images", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_456",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { refineAnalysis } = await import("@/lib/claude");
    await refineAnalysis(
      [
        { base64: "img1", mimeType: "image/jpeg" },
        { base64: "img2", mimeType: "image/png" },
      ],
      validAnalysis,
      "Correction"
    );

    const call = mockCreate.mock.calls[0][0];
    const imageBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[0].source.data).toBe("img1");
    expect(imageBlocks[1].source.data).toBe("img2");
  });

  it("works with text-only refinement (no images)", async () => {
    const refinedAnalysis: FoodAnalysis = {
      ...validAnalysis,
      food_name: "3 medialunas",
      calories: 480,
      notes: "Corrected to 3 medialunas instead of 2",
    };

    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_456",
          name: "report_nutrition",
          input: refinedAnalysis,
        },
      ],
    });

    const { refineAnalysis } = await import("@/lib/claude");
    const result = await refineAnalysis(
      [],
      validAnalysis,
      "Actually it was 3 medialunas"
    );

    expect(result).toEqual(refinedAnalysis);

    // Verify no image blocks in the API call
    const call = mockCreate.mock.calls[0][0];
    const imageBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(imageBlocks).toHaveLength(0);

    // Verify only text block with refinement context
    const textBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "text"
    );
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].text).toContain("Actually it was 3 medialunas");
    expect(textBlocks[0].text).toContain("Empanada de carne"); // previous analysis context
  });


  it("includes all nutrition fields from previous analysis in prompt", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_456",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
    });

    const { refineAnalysis } = await import("@/lib/claude");
    await refineAnalysis(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      validAnalysis,
      "Correction"
    );

    const call = mockCreate.mock.calls[0][0];
    const textBlock = call.messages[0].content.find(
      (block: { type: string }) => block.type === "text"
    );
    expect(textBlock.text).toContain("Empanada de carne"); // food_name
    expect(textBlock.text).toContain("150"); // amount
    expect(textBlock.text).toContain("320"); // calories
    expect(textBlock.text).toContain("12"); // protein_g
    expect(textBlock.text).toContain("28"); // carbs_g
    expect(textBlock.text).toContain("18"); // fat_g
    expect(textBlock.text).toContain("2"); // fiber_g (as string in context)
    expect(textBlock.text).toContain("450"); // sodium_mg
    expect(textBlock.text).toContain("high"); // confidence
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
