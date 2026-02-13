import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FoodChat } from "../food-chat";
import type { FoodAnalysis, FoodLogResponse } from "@/types";

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
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock MealTypeSelector (uses Radix Select internally)
vi.mock("../meal-type-selector", () => ({
  MealTypeSelector: ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (id: number) => void;
  }) => (
    <div data-testid="meal-type-selector">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
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

beforeEach(() => {
  vi.clearAllMocks();
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

  it("shows analysis summary in assistant message when analysis is present", async () => {
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
      expect(screen.getByText(/165 cal/)).toBeInTheDocument();
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
});
