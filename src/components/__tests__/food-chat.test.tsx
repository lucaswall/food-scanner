import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { FoodChat } from "../food-chat";
import type { FoodAnalysis, FoodLogResponse, ConversationMessage } from "@/types";
import type { StreamEvent } from "@/lib/sse";
import { compressImage } from "@/lib/image";

// Helper to create SSE mock fetch responses.
// Uses a manual reader mock instead of ReadableStream to avoid jsdom stream quirks.
function makeSSEFetchResponse(events: StreamEvent[], ok = true) {
  const encoder = new TextEncoder();
  const data = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const encoded = encoder.encode(data);

  let readCalled = false;
  const mockReader = {
    read: vi.fn().mockImplementation(() => {
      if (!readCalled) {
        readCalled = true;
        return Promise.resolve({ done: false as const, value: encoded });
      }
      return Promise.resolve({ done: true as const, value: undefined });
    }),
    releaseLock: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
  };

  return {
    ok,
    headers: new Headers({ "Content-Type": "text/event-stream" }),
    body: { getReader: () => mockReader },
  };
}

// Mock ResizeObserver for Radix UI and scrollIntoView for auto-scroll
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // Mock scrollIntoView for message list auto-scroll
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // Mock FileReader to fire onload synchronously instead of as a macrotask.
  // Real FileReader.readAsDataURL fires onload as a macrotask, which can leak
  // across test boundaries and cause flaky failures when running alongside
  // other test files.
  global.FileReader = class MockFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL() {
      this.result = "data:image/jpeg;base64,dGVzdA==";
      // Fire synchronously — resolve() inside the Promise constructor is still
      // deferred via microtask, which is deterministic and won't leak.
      this.onload?.();
    }
  } as unknown as typeof FileReader;
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock MealTypeSelector (uses Radix Select internally)
vi.mock("../meal-type-selector", () => ({
  MealTypeSelector: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: number;
    onChange: (id: number) => void;
    ariaLabel?: string;
  }) => (
    <div data-testid="meal-type-selector">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
      >
        <option value="1">Breakfast</option>
        <option value="3">Lunch</option>
        <option value="5">Dinner</option>
      </select>
    </div>
  ),
}));

// Mock compressImage
vi.mock("@/lib/image", () => ({
  compressImage: vi.fn((file: File) => Promise.resolve(new Blob([file.name]))),
}));

// Mock pending-submission
vi.mock("@/lib/pending-submission", () => ({
  savePendingSubmission: vi.fn(),
  getPendingSubmission: vi.fn().mockReturnValue(null),
  clearPendingSubmission: vi.fn(),
}));

const mockAnalysis: FoodAnalysis = {
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
  notes: "Standard Argentine beef empanada",
  description: "A golden-brown baked empanada on a white plate",
  keywords: ["empanada", "carne", "beef"],
};

const mockLogResponse: FoodLogResponse = {
  success: true,
  fitbitFoodId: 12345,
  fitbitLogId: 67890,
  reusedFood: false,
};

const mockCompressedImages = [new Blob(["image1"]), new Blob(["image2"])];

const defaultProps = {
  initialAnalysis: mockAnalysis,
  compressedImages: mockCompressedImages,
  initialMealTypeId: 3,
  onClose: vi.fn(),
  onLogged: vi.fn(),
};

// Props for SSE tests — no initial images to avoid FileReader macrotask timing issues
const sseProps = {
  initialAnalysis: mockAnalysis,
  compressedImages: [] as Blob[],
  initialMealTypeId: 3,
  onClose: vi.fn(),
  onLogged: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

describe("FoodChat", () => {
  it("renders initial assistant message from the initial analysis", () => {
    render(<FoodChat {...defaultProps} />);

    expect(screen.getByText(/empanada de carne/i)).toBeInTheDocument();
    expect(screen.getByText(/320 cal/i)).toBeInTheDocument();
  });

  it("renders text input with send button at bottom", () => {
    render(<FoodChat {...defaultProps} />);

    expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("renders Log to Fitbit button always visible", () => {
    render(<FoodChat {...defaultProps} />);

    expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
  });

  it("renders floating back button", () => {
    render(<FoodChat {...defaultProps} />);

    const backButton = screen.getByRole("button", { name: /back/i });
    expect(backButton).toBeInTheDocument();
  });

  it("renders MealTypeSelector with initialMealTypeId", () => {
    render(<FoodChat {...defaultProps} />);

    const selector = screen.getByTestId("meal-type-selector");
    expect(selector).toBeInTheDocument();
    const select = selector.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("3");
  });

  it("does not show photo indicator on entry (initial images are sent silently)", () => {
    render(<FoodChat {...defaultProps} />);

    expect(screen.queryByTestId("photo-indicator")).not.toBeInTheDocument();
  });

  it("plus button toggles inline photo menu", () => {
    render(<FoodChat {...defaultProps} />);

    const plusButton = screen.getByRole("button", { name: /add photo/i });
    expect(screen.queryByTestId("photo-menu")).not.toBeInTheDocument();

    fireEvent.click(plusButton);
    expect(screen.getByTestId("photo-menu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose from gallery/i })).toBeInTheDocument();

    // Click again to close
    fireEvent.click(plusButton);
    expect(screen.queryByTestId("photo-menu")).not.toBeInTheDocument();
  });

  it("typing and sending a message calls POST /api/chat-food with initialAnalysis", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: {
            message: "Sure, I can help with that!",
          },
        })),
    });

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    const sendButton = screen.getByRole("button", { name: /send/i });

    fireEvent.change(input, { target: { value: "Actually it was 2 empanadas" } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/chat-food",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toBe("Actually it was 2 empanadas");
    expect(body.initialAnalysis).toEqual(mockAnalysis);
  });

  it("sends initial images silently with first message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: { message: "I see the food" },
        })),
    });

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "What's this?" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/chat-food", expect.any(Object));
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    // Initial compressed images sent silently
    expect(body.images).toBeDefined();
    expect(body.images).toHaveLength(2);
  });

  it("does not re-send initial images on second message", async () => {
    // First message
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: { message: "Got it!" },
        })),
    });

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText("Got it!")).toBeInTheDocument();
    });

    // Second message
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: { message: "OK" },
        })),
    });

    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    const secondCallArgs = mockFetch.mock.calls[1];
    const secondBody = JSON.parse(secondCallArgs[1].body);
    // No images on second message
    expect(secondBody.images).toBeUndefined();
  });

  it("re-sends initial images on retry after first message fails (FOO-574)", async () => {
    // Use sseProps (no compressed images) to avoid FileReader macrotask leakage,
    // then verify the stale closure via initialImagesSent ref behavior.
    // The bug: revertOnError captures stale `initialImagesSent = false`, so after
    // setInitialImagesSent(true) + error, the flag is never reverted.
    // We test with SSE error events and no initial images, but with user-added images.

    // Instead, test the stale closure directly: render with compressedImages,
    // first send fails (JSON path for reliable timing), retry should include images.
    const { unmount } = render(<FoodChat {...defaultProps} />);

    // First message: HTTP error
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: false,
          error: { code: "CLAUDE_API_ERROR", message: "Temporary failure" },
        })),
    });

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "What's this?" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    // Wait for first fetch (FileReader macrotask for blobsToBase64 must complete first)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Verify first call sent images
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(firstBody.images).toHaveLength(2);

    // Wait for error to appear and loading to finish
    await waitFor(() => {
      expect(screen.getByText(/temporary failure/i)).toBeInTheDocument();
      expect(input).not.toBeDisabled();
    });

    // Retry: second message should re-send initial images
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: { message: "I see the food" },
        })),
    });

    fireEvent.change(input, { target: { value: "What's this?" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    // Wait for retry response to be fully consumed
    await waitFor(() => {
      expect(screen.getByText("I see the food")).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    // Images should be present on retry (not lost due to stale closure)
    expect(retryBody.images).toBeDefined();
    expect(retryBody.images).toHaveLength(2);

    // Explicit unmount to prevent FileReader macrotask leakage to subsequent tests
    unmount();
  });

  it("assistant response is displayed in message list", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: {
            message: "Got it, updating to 2 empanadas!",
          },
        })),
    });

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "Make it 2" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/got it, updating to 2 empanadas!/i)).toBeInTheDocument();
    });
  });

  it("when assistant response includes analysis, that analysis is used by Log button", async () => {
    const updatedAnalysis: FoodAnalysis = {
      ...mockAnalysis,
      amount: 300,
      calories: 640,
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(JSON.stringify({
            success: true,
            data: {
              message: "Updated to 2 empanadas",
              analysis: updatedAnalysis,
            },
          })),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(JSON.stringify({
            success: true,
            data: mockLogResponse,
          })),
      });

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "Make it 2" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/updated to 2 empanadas/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/log-food",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const logCallArgs = mockFetch.mock.calls.find(
      (call: unknown[]) => call[0] === "/api/log-food"
    );
    const logBody = JSON.parse(logCallArgs![1].body);
    expect(logBody.calories).toBe(640);
    expect(logBody.amount).toBe(300);

    // onLogged should receive the refined analysis (updated one with 640 calories) and mealTypeId
    await waitFor(() => {
      expect(defaultProps.onLogged).toHaveBeenCalledWith(
        mockLogResponse,
        expect.objectContaining({ calories: 640, amount: 300 }),
        expect.any(Number)
      );
    });
  });

  it("clicking Log to Fitbit calls /api/log-food with the latest analysis", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: mockLogResponse,
        })),
    });

    render(<FoodChat {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/log-food",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    // onLogged should receive the response, initial analysis, and mealTypeId
    await waitFor(() => {
      expect(defaultProps.onLogged).toHaveBeenCalledWith(
        mockLogResponse,
        mockAnalysis,
        expect.any(Number)
      );
    });
  });

  it("sends reuseCustomFoodId when initialAnalysis has sourceCustomFoodId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: mockLogResponse,
        })),
    });

    const analysisWithSourceId: FoodAnalysis = {
      ...mockAnalysis,
      sourceCustomFoodId: 42,
    };

    render(
      <FoodChat
        {...defaultProps}
        initialAnalysis={analysisWithSourceId}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      const logFoodCall = mockFetch.mock.calls.find(
        (call: unknown[]) => call[0] === "/api/log-food"
      );
      expect(logFoodCall).toBeDefined();
      const body = JSON.parse(logFoodCall![1].body);
      expect(body.reuseCustomFoodId).toBe(42);
    });
  });

  it("Log to Fitbit button shows loading state while logging", async () => {
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    );

    render(<FoodChat {...defaultProps} />);

    const logButton = screen.getByRole("button", { name: /log to fitbit/i });
    fireEvent.click(logButton);

    await waitFor(() => {
      expect(screen.getByText(/logging/i)).toBeInTheDocument();
    });
  });

  it("clicking back button calls onClose callback", () => {
    const onClose = vi.fn();

    render(<FoodChat {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows loading indicator while waiting for chat response", async () => {
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    );

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-loading")).toBeInTheDocument();
    });
  });

  it("shows error message on chat API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: false,
          error: { code: "CLAUDE_API_ERROR", message: "Failed to process message" },
        })),
    });

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to process message/i)).toBeInTheDocument();
    });
  });

  it("send button is disabled when input is empty", () => {
    render(<FoodChat {...defaultProps} />);

    const sendButton = screen.getByRole("button", { name: /send/i });
    expect(sendButton).toBeDisabled();
  });

  it("shows nutrition card in assistant message when analysis is present", async () => {
    const updatedAnalysis: FoodAnalysis = {
      ...mockAnalysis,
      food_name: "Mixed cocktail",
      calories: 165,
      protein_g: 0,
      carbs_g: 5,
      fat_g: 0,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: {
            message: "Let me analyze this for you:",
            analysis: updatedAnalysis,
          },
        })),
    });

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "Mix them" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText("Mixed cocktail")).toBeInTheDocument();
      expect(screen.getByText("165")).toBeInTheDocument();
      expect(screen.getByText("cal")).toBeInTheDocument();
      expect(screen.getByText(/P: 0g/)).toBeInTheDocument();
    });
  });

  it("send button is disabled while loading", async () => {
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    );

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    const sendButton = screen.getByRole("button", { name: /send/i });

    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(sendButton).toBeDisabled();
    });
  });

  it("does not send images when no initial or pending images exist", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: { message: "OK" },
        })),
    });

    render(<FoodChat {...defaultProps} compressedImages={[]} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.images).toBeUndefined();
  });

  it("sends latest analysis (not stale initial) on second chat turn", async () => {
    const updatedAnalysis: FoodAnalysis = {
      ...mockAnalysis,
      calories: 200,
      amount: 100,
    };

    // First message returns updated analysis
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: {
            message: "Updated to 200 cal",
            analysis: updatedAnalysis,
          },
        })),
    });

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);

    // Send first message
    fireEvent.change(input, { target: { value: "It's smaller" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText("Updated to 200 cal")).toBeInTheDocument();
    });

    // Second message
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: { message: "Got it" },
        })),
    });

    fireEvent.change(input, { target: { value: "And less fat" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    const secondCallArgs = mockFetch.mock.calls[1];
    const secondBody = JSON.parse(secondCallArgs[1].body);
    // Should send the UPDATED analysis (200 cal), not the original (320 cal)
    expect(secondBody.initialAnalysis.calories).toBe(200);
    expect(secondBody.initialAnalysis.amount).toBe(100);
  });

  it("shows correct unit label for non-gram units in nutrition card", async () => {
    const cupsAnalysis: FoodAnalysis = {
      ...mockAnalysis,
      food_name: "Orange juice",
      amount: 2,
      unit_id: 91, // cups
      calories: 220,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: true,
          data: {
            message: "Analyzed",
            analysis: cupsAnalysis,
          },
        })),
    });

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "What is this?" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText("Orange juice")).toBeInTheDocument();
      // Should show "2 cups" not "2 units" in the nutrition card
      expect(screen.queryByText(/2 units/)).not.toBeInTheDocument();
      expect(screen.getByText(/2 cups/)).toBeInTheDocument();
    });
  });

  it("scroll-to-bottom button has 44px touch target", () => {
    const { container } = render(<FoodChat {...defaultProps} />);

    // Simulate scroll state to show the button
    const scrollContainer = container.querySelector('[class*="overflow-y-auto"]') as HTMLElement;
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, configurable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, configurable: true });

    fireEvent.scroll(scrollContainer);

    const scrollButton = screen.getByRole("button", { name: /scroll to bottom/i });
    expect(scrollButton).toHaveClass("size-11"); // 44px x 44px
  });

  it("MealTypeSelector has accessible label", () => {
    render(<FoodChat {...defaultProps} />);

    const selector = screen.getByLabelText("Meal type");
    expect(selector).toBeInTheDocument();
  });

  it("plus button is disabled at message limit", async () => {
    // MAX_MESSAGES = 30. apiMessageCount = messages.length - 1 (excludes initial)
    // Each user+assistant pair adds 2 to messages. To hit limit: 1 + 2*15 = 31 messages, apiMessageCount = 30
    const messagesToSend = 15;

    for (let i = 0; i < messagesToSend; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(JSON.stringify({
            success: true,
            data: { message: `Response ${i}` },
          })),
      });
    }

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    const sendButton = screen.getByRole("button", { name: /send/i });

    // Send messages to hit the limit
    for (let i = 0; i < messagesToSend; i++) {
      fireEvent.change(input, { target: { value: `Message ${i}` } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(`Response ${i}`)).toBeInTheDocument();
      });
    }

    // Now at limit, plus button should be disabled
    const plusButton = screen.getByRole("button", { name: /add photo/i });
    expect(plusButton).toBeDisabled();
  });

  it("chat input has maxLength of 500", () => {
    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i) as HTMLInputElement;
    expect(input.maxLength).toBe(500);
  });

  it("chat input has aria-label Message (FOO-605)", () => {
    render(<FoodChat {...defaultProps} />);

    const input = screen.getByRole("textbox", { name: "Message" });
    expect(input).toHaveAttribute("aria-label", "Message");
  });

  it("messages scroll container has role=log and aria-live=polite (FOO-604)", () => {
    render(<FoodChat {...defaultProps} />);

    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveAttribute("aria-atomic", "false");
  });

  it("error message is dismissible", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () =>
        Promise.resolve(JSON.stringify({
          success: false,
          error: { code: "ERROR", message: "Test error message" },
        })),
    });

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/test error message/i)).toBeInTheDocument();
    });

    // Find and click dismiss button
    const dismissButton = screen.getByRole("button", { name: /dismiss error/i });
    fireEvent.click(dismissButton);

    // Error should be removed
    expect(screen.queryByText(/test error message/i)).not.toBeInTheDocument();
  });

  it("shows improved near-limit warning text", async () => {
    // Send 13 messages to get to near-limit (apiMessageCount = 26, 4 remaining out of 30)
    for (let i = 0; i < 13; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(JSON.stringify({
            success: true,
            data: { message: `Response ${i}` },
          })),
      });
    }

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    const sendButton = screen.getByRole("button", { name: /send/i });

    // Send messages
    for (let i = 0; i < 13; i++) {
      fireEvent.change(input, { target: { value: `Message ${i}` } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(`Response ${i}`)).toBeInTheDocument();
      });
    }

    // Should show "refinements remaining" not "messages remaining"
    expect(screen.getByText(/refinements remaining/i)).toBeInTheDocument();
    expect(screen.queryByText(/messages remaining/i)).not.toBeInTheDocument();
  });

  it("shows at-limit message when limit is reached", async () => {
    // Send 15 messages to hit the limit
    for (let i = 0; i < 15; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(JSON.stringify({
            success: true,
            data: { message: `Response ${i}` },
          })),
      });
    }

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    const sendButton = screen.getByRole("button", { name: /send/i });

    // Send messages to hit limit
    for (let i = 0; i < 15; i++) {
      fireEvent.change(input, { target: { value: `Message ${i}` } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(`Response ${i}`)).toBeInTheDocument();
      });
    }

    // Should show "Refinement limit reached"
    expect(screen.getByText(/refinement limit reached/i)).toBeInTheDocument();
  });

  it("shows warning when some photos fail compression", async () => {
    // Mock compressImage to fail for the second file
    const mockCompressImage = vi.mocked(compressImage);
    mockCompressImage
      .mockResolvedValueOnce(new Blob(["file1"]))
      .mockRejectedValueOnce(new Error("Compression failed"))
      .mockResolvedValueOnce(new Blob(["file3"]));

    render(<FoodChat {...defaultProps} />);

    // Open photo menu and select gallery
    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
    const galleryInput = screen.getByTestId("chat-gallery-input");

    // Select 3 files
    const files = [
      new File(["file1"], "photo1.jpg", { type: "image/jpeg" }),
      new File(["file2"], "photo2.jpg", { type: "image/jpeg" }),
      new File(["file3"], "photo3.jpg", { type: "image/jpeg" }),
    ];
    Object.defineProperty(galleryInput, "files", { value: files });
    fireEvent.change(galleryInput);

    // Should show compression warning
    await waitFor(() => {
      expect(screen.getByText(/1 of 3 photos couldn't be processed/i)).toBeInTheDocument();
    });

    // Should still show 2 successful photos in indicator
    expect(screen.getByText(/2 photos/i)).toBeInTheDocument();
  });

  it("shows loading indicator during photo compression", async () => {
    // Mock compressImage with delay
    const mockCompressImage = vi.mocked(compressImage);
    mockCompressImage.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(new Blob(["file"])), 100))
    );

    render(<FoodChat {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
    const galleryInput = screen.getByTestId("chat-gallery-input");

    const files = [new File(["file1"], "photo1.jpg", { type: "image/jpeg" })];
    Object.defineProperty(galleryInput, "files", { value: files });
    fireEvent.change(galleryInput);

    // Should show loading indicator
    expect(screen.getByText(/processing photos/i)).toBeInTheDocument();

    // Wait for compression to complete
    await waitFor(() => {
      expect(screen.queryByText(/processing photos/i)).not.toBeInTheDocument();
    });
  });

  it("closes photo menu on Escape key", () => {
    render(<FoodChat {...defaultProps} />);

    // Open photo menu
    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
    expect(screen.getByTestId("photo-menu")).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: "Escape" });

    // Menu should close
    expect(screen.queryByTestId("photo-menu")).not.toBeInTheDocument();
  });

  it("closes photo menu on outside click", () => {
    render(<FoodChat {...defaultProps} />);

    // Open photo menu
    const plusButton = screen.getByRole("button", { name: /add photo/i });
    fireEvent.click(plusButton);
    expect(screen.getByTestId("photo-menu")).toBeInTheDocument();

    // Click outside (on document body)
    fireEvent.mouseDown(document.body);

    // Menu should close
    expect(screen.queryByTestId("photo-menu")).not.toBeInTheDocument();
  });

  it("shows timeout error for chat API timeout", async () => {
    mockFetch.mockRejectedValueOnce(
      new DOMException("signal timed out", "TimeoutError")
    );

    render(<FoodChat {...defaultProps} />);

    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/request timed out/i)).toBeInTheDocument();
    });
  });

  it("shows timeout error for log API timeout", async () => {
    mockFetch.mockRejectedValueOnce(
      new DOMException("signal timed out", "TimeoutError")
    );

    render(<FoodChat {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(screen.getByText(/request timed out/i)).toBeInTheDocument();
    });
  });

  // FOO-413: FoodChat missing FITBIT_TOKEN_INVALID handling
  it("saves pending and redirects on FITBIT_TOKEN_INVALID", async () => {
    // Override window.location for this test
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });

    const { savePendingSubmission } = await import("@/lib/pending-submission");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve(JSON.stringify({
        success: false,
        error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" },
      })),
    });

    render(<FoodChat {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(savePendingSubmission).toHaveBeenCalled();
      expect(window.location.href).toBe("/api/auth/fitbit");
    });

    // Restore
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });

  it("shows specific error for FITBIT_CREDENTIALS_MISSING", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve(JSON.stringify({
        success: false,
        error: { code: "FITBIT_CREDENTIALS_MISSING", message: "Credentials not found" },
      })),
    });

    render(<FoodChat {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));

    await waitFor(() => {
      expect(screen.getByText(/credentials in Settings/i)).toBeInTheDocument();
    });
  });

  it("header has single-row layout: Back, MealTypeSelector, Log button", () => {
    render(<FoodChat {...defaultProps} />);

    const backButton = screen.getByRole("button", { name: /back/i });
    const logButton = screen.getByRole("button", { name: /log to fitbit/i });
    const mealTypeSelector = screen.getByTestId("meal-type-selector");

    // All three controls should share the same parent flex row
    const row = backButton.parentElement;
    expect(row).toContainElement(logButton);
    expect(row).toContainElement(mealTypeSelector);

    // The row should be a flex container (not space-y-2 / two rows)
    expect(row?.className).toMatch(/flex/);
    expect(row?.className).not.toMatch(/space-y/);

    // MealTypeSelector should be between back and log in DOM order
    const children = Array.from(row!.children);
    const backIdx = children.indexOf(backButton);
    const selectorIdx = children.findIndex(el => el.contains(mealTypeSelector) || el === mealTypeSelector);
    const logIdx = children.indexOf(logButton);
    expect(backIdx).toBeLessThan(selectorIdx);
    expect(selectorIdx).toBeLessThan(logIdx);
  });

  // FOO-519: Free-form chat mode tests (no initial analysis)
  describe("free-form mode (no initial analysis)", () => {
    it("renders greeting message when no initialAnalysis provided", () => {
      render(
        <FoodChat
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      expect(
        screen.getByText(/Hi! Ask me anything about your nutrition/i)
      ).toBeInTheDocument();
      expect(screen.queryByText(/I analyzed your food/i)).not.toBeInTheDocument();
    });

    it("header shows title when no analysis present, hides Log button and MealTypeSelector", () => {
      render(
        <FoodChat
          title="Chat"
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      // Should show title
      expect(screen.getByText("Chat")).toBeInTheDocument();

      // Should NOT show Log to Fitbit button or MealTypeSelector
      expect(screen.queryByRole("button", { name: /log to fitbit/i })).not.toBeInTheDocument();
      expect(screen.queryByTestId("meal-type-selector")).not.toBeInTheDocument();
    });

    it("header updates to show Log button and MealTypeSelector when analysis arrives from API", async () => {
      const analysisFromAPI: FoodAnalysis = {
        food_name: "Salad",
        amount: 200,
        unit_id: 147,
        calories: 150,
        protein_g: 5,
        carbs_g: 20,
        fat_g: 5,
        fiber_g: 3,
        sodium_mg: 100,
        saturated_fat_g: null,
        trans_fat_g: null,
        sugars_g: null,
        calories_from_fat: null,
        confidence: "high",
        notes: "Fresh salad",
        description: "Green salad",
        keywords: ["salad"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: {
                message: "I see a salad!",
                analysis: analysisFromAPI,
              },
            })
          ),
      });

      render(
        <FoodChat
          title="Chat"
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      // Initially no Log button or MealTypeSelector
      expect(screen.queryByRole("button", { name: /log to fitbit/i })).not.toBeInTheDocument();
      expect(screen.queryByTestId("meal-type-selector")).not.toBeInTheDocument();

      // Send a message
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "What's this?" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      // After response with analysis, header should update
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /log to fitbit/i })).toBeInTheDocument();
      });

      expect(screen.getByTestId("meal-type-selector")).toBeInTheDocument();
    });

    it("shows MiniNutritionCard when first analysis arrives mid-conversation", async () => {
      const analysisFromAPI: FoodAnalysis = {
        food_name: "Pizza slice",
        amount: 150,
        unit_id: 311,
        calories: 285,
        protein_g: 12,
        carbs_g: 36,
        fat_g: 10,
        fiber_g: 2,
        sodium_mg: 640,
        saturated_fat_g: null,
        trans_fat_g: null,
        sugars_g: null,
        calories_from_fat: null,
        confidence: "high",
        notes: "Pepperoni pizza",
        description: "Pizza slice",
        keywords: ["pizza"],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: {
                message: "I analyzed this as a pizza slice!",
                analysis: analysisFromAPI,
              },
            })
          ),
      });

      render(
        <FoodChat
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "I had pizza" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      // MiniNutritionCard should appear
      await waitFor(() => {
        expect(screen.getByText("Pizza slice")).toBeInTheDocument();
        expect(screen.getByText("285")).toBeInTheDocument();
        expect(screen.getByText("cal")).toBeInTheDocument();
      });
    });

    it("image attachment works in free-form mode", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: { message: "I see the food!" },
            })
          ),
      });

      render(
        <FoodChat
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      // Open photo menu and select gallery
      fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
      const galleryInput = screen.getByTestId("chat-gallery-input");

      const files = [new File(["photo"], "photo.jpg", { type: "image/jpeg" })];
      Object.defineProperty(galleryInput, "files", { value: files });
      fireEvent.change(galleryInput);

      // Photo indicator should appear
      await waitFor(() => {
        expect(screen.getByTestId("photo-indicator")).toBeInTheDocument();
      });

      // Send message with photo
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "What is this?" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      // Verify images were sent
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.images).toBeDefined();
    });

    it("API calls go to /api/chat-food in free-form mode", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: { message: "Response" },
            })
          ),
      });

      render(
        <FoodChat
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Test" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/chat-food",
          expect.objectContaining({
            method: "POST",
          })
        );
      });
    });

    it("uses default meal type when no initialMealTypeId provided", async () => {
      const analysisFromAPI: FoodAnalysis = {
        ...mockAnalysis,
        food_name: "Test food",
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                success: true,
                data: {
                  message: "Analyzed",
                  analysis: analysisFromAPI,
                },
              })
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                success: true,
                data: mockLogResponse,
              })
            ),
        });

      render(
        <FoodChat
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      // Get analysis first
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Food" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(screen.getByTestId("meal-type-selector")).toBeInTheDocument();
      });

      // MealTypeSelector should have a default value from getDefaultMealType()
      const selector = screen.getByTestId("meal-type-selector");
      const select = selector.querySelector("select") as HTMLSelectElement;
      // Default meal type is determined by time of day, so just verify it's set
      expect(select.value).toMatch(/^[1-7]$/);
    });
  });

  // FOO-641: AbortSignal.any() browser compatibility
  describe("AbortSignal.any fallback", () => {
    it("chat works when AbortSignal.any is not available (older browsers)", async () => {
      const originalAny = AbortSignal.any;
      // Simulate older browser that doesn't have AbortSignal.any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (AbortSignal as any).any = undefined;

      try {
        mockFetch.mockResolvedValueOnce(
          makeSSEFetchResponse([
            { type: "text_delta", text: "Response without AbortSignal.any" },
            { type: "done" },
          ])
        );

        render(<FoodChat {...sseProps} />);
        const input = screen.getByPlaceholderText(/type a message/i);
        fireEvent.change(input, { target: { value: "Test" } });
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: /send/i }));
        });

        // Fetch should have been called with a signal (manual fallback)
        await waitFor(() => {
          expect(mockFetch).toHaveBeenCalledWith(
            "/api/chat-food",
            expect.objectContaining({ signal: expect.any(AbortSignal) })
          );
        });
        // Response rendered proves the request completed successfully
        expect(screen.getByText("Response without AbortSignal.any")).toBeInTheDocument();
      } finally {
        // Restore
        AbortSignal.any = originalAny;
      }
    });
  });

  // FOO-642: response.body null guard
  describe("response.body null guard", () => {
    it("shows error gracefully when response.body is null for SSE", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "Content-Type": "text/event-stream" }),
        body: null,
      });

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Test message" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      // Should show an error and revert the user message
      await waitFor(() => {
        expect(screen.getByText(/no response body/i)).toBeInTheDocument();
      });
      // User message should be reverted
      expect(input).toHaveValue("Test message");
    });
  });

  // FOO-576: AbortController cleanup on unmount
  describe("AbortController cleanup", () => {
    it("aborts in-flight SSE request on unmount", async () => {
      const abortSpy = vi.spyOn(AbortController.prototype, "abort");

      // Make fetch hang (never resolve) to keep the SSE stream active
      mockFetch.mockImplementationOnce(() => new Promise(() => {}));

      const { unmount } = render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Test message" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      // Wait for loading state to confirm fetch was initiated
      await waitFor(() => {
        expect(screen.getByTestId("chat-loading")).toBeInTheDocument();
      });

      // Unmount while stream is active
      unmount();

      expect(abortSpy).toHaveBeenCalled();
      abortSpy.mockRestore();
    });
  });

  // FOO-579: Consecutive tool_start events should not create empty bubbles
  describe("consecutive tool_start dedup", () => {
    it("consecutive tool_start events produce only one empty assistant message", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "Hello" },
          { type: "tool_start", tool: "search_food_log" },
          { type: "tool_start", tool: "get_nutrition_summary" },
          { type: "text_delta", text: "Here's what I found" },
          { type: "done" },
        ])
      );

      const { container } = render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "What did I eat?" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      // "Hello" should become a thinking message
      const thinkingEls = screen.getAllByTestId("thinking-message");
      expect(thinkingEls).toHaveLength(1);

      // Final response should be visible
      expect(screen.getByText("Here's what I found")).toBeInTheDocument();

      // Count assistant-side message bubbles (justify-start) that are NOT the
      // initial greeting and NOT the thinking bubble. The second tool_start
      // should NOT have created an extra empty bubble.
      const assistantBubbles = container.querySelectorAll('[class*="justify-start"]');
      // Expected: 1 initial greeting + 1 thinking("Hello") + 1 final("Here's what I found") = 3
      // Bug: would be 4 (extra empty bubble from second tool_start)
      expect(assistantBubbles).toHaveLength(3);
    });
  });

  // FOO-557: SSE streaming
  describe("SSE streaming", () => {
    it("text_delta events build assistant message content", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "Hello " },
          { type: "text_delta", text: "world" },
          { type: "done" },
        ])
      );

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Hi there" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    it("analysis event from SSE attaches analysis to assistant message", async () => {
      const updatedAnalysis: FoodAnalysis = { ...mockAnalysis, calories: 640, amount: 300 };

      mockFetch
        .mockResolvedValueOnce(
          makeSSEFetchResponse([
            { type: "text_delta", text: "Updated to 2 empanadas" },
            { type: "analysis", analysis: updatedAnalysis },
            { type: "done" },
          ])
        )
        .mockResolvedValueOnce({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({ success: true, data: mockLogResponse })
            ),
        });

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Make it 2" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      expect(screen.getByText("Updated to 2 empanadas")).toBeInTheDocument();

      // Log button should use the updated analysis from SSE
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /log to fitbit/i }));
      });

      const logCall = mockFetch.mock.calls.find(
        (call: unknown[]) => call[0] === "/api/log-food"
      );
      expect(logCall).toBeDefined();
      const body = JSON.parse(((logCall as unknown[])[1] as { body: string }).body);
      expect(body.calories).toBe(640);
      expect(body.amount).toBe(300);
    });

    it("error event from SSE shows error and reverts user message", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "Thinking..." },
          { type: "error", message: "Failed to process message" },
        ])
      );

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Hi there" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      expect(screen.getByText(/failed to process message/i)).toBeInTheDocument();
      // User message should be reverted, input restored
      expect(input).toHaveValue("Hi there");
      // User message bubble should not remain in chat
      expect(screen.queryByText("Hi there")).not.toBeInTheDocument();
    });

    it("loading state clears after SSE done event", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "Response complete" },
          { type: "done" },
        ])
      );

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Test" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      expect(screen.queryByTestId("chat-loading")).not.toBeInTheDocument();
    });

    it("input is re-enabled after SSE stream completes", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "Done" },
          { type: "done" },
        ])
      );

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Test" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      expect(input).not.toBeDisabled();
    });

    it("SSE stream: requests still include initialAnalysis and images", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "Got it" },
          { type: "done" },
        ])
      );

      // Uses defaultProps (with images) intentionally — images go through FileReader (macrotask)
      // so we use waitFor for the fetch assertion rather than act
      render(<FoodChat {...defaultProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Hi" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/chat-food",
          expect.objectContaining({ method: "POST" })
        );
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(((callArgs as unknown[])[1] as { body: string }).body);
      expect(body.initialAnalysis).toEqual(mockAnalysis);
      expect(body.images).toHaveLength(2); // initial images sent on first message
    });
  });

  // FOO-558: Thinking messages
  describe("thinking messages", () => {
    it("tool_start event splits message: prior text becomes thinking, new message starts", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "Let me check your history..." },
          { type: "tool_start", tool: "search_food_log" },
          { type: "text_delta", text: "Based on your history, here's the answer" },
          { type: "done" },
        ])
      );

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "What did I eat?" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      expect(screen.getByText("Let me check your history...")).toBeInTheDocument();
      expect(screen.getByText("Based on your history, here's the answer")).toBeInTheDocument();
    });

    it("thinking text is rendered with data-testid=thinking-message", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "Searching..." },
          { type: "tool_start", tool: "search_food_log" },
          { type: "text_delta", text: "Final answer" },
          { type: "done" },
        ])
      );

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Check" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      const thinkingEl = screen.getByTestId("thinking-message");
      expect(thinkingEl).toBeInTheDocument();
    });

    it("thinking messages persist in conversation history after response completes", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "Checking logs..." },
          { type: "tool_start", tool: "search_food_log" },
          { type: "text_delta", text: "I found your entry" },
          { type: "done" },
        ])
      );

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Find food" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      // Both thinking text and final response should remain visible
      expect(screen.getByText("Checking logs...")).toBeInTheDocument();
      expect(screen.getByText("I found your entry")).toBeInTheDocument();
    });

    it("thinking messages are excluded from next API call payload", async () => {
      // First message: triggers thinking
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "Searching..." },
          { type: "tool_start", tool: "search" },
          { type: "text_delta", text: "Here's what I found" },
          { type: "done" },
        ])
      );
      // Second message: plain response
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([{ type: "text_delta", text: "OK" }, { type: "done" }])
      );

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);

      fireEvent.change(input, { target: { value: "Find food" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      expect(screen.getByText("Here's what I found")).toBeInTheDocument();

      fireEvent.change(input, { target: { value: "Follow up" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const secondCallArgs = mockFetch.mock.calls[1];
      const body = JSON.parse(((secondCallArgs as unknown[])[1] as { body: string }).body);
      // Thinking messages should be filtered from the payload
      const thinkingMessages = body.messages.filter(
        (m: { isThinking?: boolean }) => m.isThinking
      );
      expect(thinkingMessages).toHaveLength(0);
    });

    it("multiple tool loops create separate thinking bubbles", async () => {
      mockFetch.mockResolvedValueOnce(
        makeSSEFetchResponse([
          { type: "text_delta", text: "First search..." },
          { type: "tool_start", tool: "search_food_log" },
          { type: "text_delta", text: "Second search..." },
          { type: "tool_start", tool: "search_food_log" },
          { type: "text_delta", text: "Final answer" },
          { type: "done" },
        ])
      );

      render(<FoodChat {...sseProps} />);
      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Complex query" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /send/i }));
      });

      const thinkingEls = screen.getAllByTestId("thinking-message");
      expect(thinkingEls).toHaveLength(2);
    });
  });

  // FOO-602: Landmark structure
  describe("landmark structure", () => {
    it("renders h1 heading even when latestAnalysis is present (analysis mode header)", () => {
      // defaultProps has initialAnalysis → latestAnalysis will be set → analysis mode header (no visible h1 in current impl)
      render(<FoodChat {...defaultProps} />);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toBeInTheDocument();
    });

    it("renders h1 heading in simple header mode (no analysis)", () => {
      render(<FoodChat title="Chat" onClose={vi.fn()} onLogged={vi.fn()} />);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toHaveTextContent("Chat");
    });
  });

  it("compression warning uses semantic warning color class, not hardcoded amber (FOO-617)", async () => {
    const mockCompressImage = vi.mocked(compressImage);
    mockCompressImage.mockRejectedValueOnce(new Error("Compression failed"));

    render(<FoodChat {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));
    const galleryInput = screen.getByTestId("chat-gallery-input");
    const files = [new File(["file1"], "photo1.jpg", { type: "image/jpeg" })];
    Object.defineProperty(galleryInput, "files", { value: files });
    fireEvent.change(galleryInput);

    await waitFor(() => {
      expect(screen.getByText(/couldn't be processed/i)).toBeInTheDocument();
    });

    const warningEl = screen.getByText(/couldn't be processed/i);
    expect(warningEl).not.toHaveClass("text-amber-600");
    expect(warningEl).not.toHaveClass("text-amber-400");
    expect(warningEl).toHaveClass("text-warning");
  });

  it("camera and gallery buttons have 44px touch target (FOO-620)", () => {
    render(<FoodChat {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /add photo/i }));

    const cameraButton = screen.getByRole("button", { name: /take photo/i });
    const galleryButton = screen.getByRole("button", { name: /choose from gallery/i });

    expect(cameraButton).toHaveClass("min-h-[44px]");
    expect(galleryButton).toHaveClass("min-h-[44px]");
  });

  // FOO-532: Seeded conversation support
  describe("seeded conversations", () => {
    const seedMessages: ConversationMessage[] = [
      { role: "user", content: "same as yesterday but half" },
      { role: "assistant", content: "Let me check what you had yesterday..." },
    ];

    it("renders seed messages when seedMessages prop is provided", () => {
      render(
        <FoodChat
          seedMessages={seedMessages}
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      expect(screen.getByText("same as yesterday but half")).toBeInTheDocument();
      expect(screen.getByText("Let me check what you had yesterday...")).toBeInTheDocument();
    });

    it("does not show default greeting when seedMessages is provided", () => {
      render(
        <FoodChat
          seedMessages={seedMessages}
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      expect(screen.queryByText(/Hi! Ask me anything/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/I analyzed your food/i)).not.toBeInTheDocument();
    });

    it("sends ALL seed messages in API request (no slice(1) skipping)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(JSON.stringify({
            success: true,
            data: { message: "Here's what I found..." },
          })),
      });

      render(
        <FoodChat
          seedMessages={seedMessages}
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Go ahead" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      // Should include all messages: 2 seed + 1 user = 3
      expect(body.messages).toHaveLength(3);
      expect(body.messages[0]).toEqual({ role: "user", content: "same as yesterday but half" });
      expect(body.messages[1]).toEqual({ role: "assistant", content: "Let me check what you had yesterday..." });
      expect(body.messages[2]).toEqual({ role: "user", content: "Go ahead" });
    });

    it("initial seed messages don't trigger limit warning", () => {
      render(
        <FoodChat
          seedMessages={seedMessages}
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      // With only 2 seed messages, we're well below the 30-message limit
      expect(screen.queryByTestId("limit-warning")).not.toBeInTheDocument();
      // Input should be enabled
      const input = screen.getByPlaceholderText(/type a message/i) as HTMLInputElement;
      expect(input).not.toBeDisabled();
    });

    it("seeded messages count toward server message limit", () => {
      // MAX_MESSAGES = 30. With seedCount = 0 (fixed), all messages count toward limit.
      // Create 27 seed messages so apiMessageCount = 27, triggering nearLimit (>= 26).
      // Before the fix: seedCount = 27, apiMessageCount = 0 → no warning.
      // After the fix: seedCount = 0, apiMessageCount = 27 → "3 refinements remaining".
      const manySeedMessages: ConversationMessage[] = [];
      for (let i = 0; i < 27; i++) {
        manySeedMessages.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        });
      }

      render(
        <FoodChat
          seedMessages={manySeedMessages}
          onClose={vi.fn()}
          onLogged={vi.fn()}
        />
      );

      // With 27 messages and seedCount=0, apiMessageCount=27, nearLimit=true
      // Should show "3 refinements remaining" (MAX_MESSAGES - 27 = 3)
      const warning = screen.getByTestId("limit-warning");
      expect(warning).toHaveTextContent("3 refinements remaining");
    });

    it("existing behavior unchanged when seedMessages is not provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(JSON.stringify({
            success: true,
            data: { message: "Response" },
          })),
      });

      render(<FoodChat {...defaultProps} />);

      const input = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(input, { target: { value: "Test" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      // Without seedMessages: slice(1) skips initial assistant message, only user message sent
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
    });
  });
});
