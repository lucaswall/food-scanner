import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FreeChat } from "../free-chat";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe("FreeChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders initial assistant greeting message", () => {
    render(<FreeChat />);

    expect(
      screen.getByText(/Hi! I can help you explore your nutrition data/)
    ).toBeInTheDocument();
  });

  it("allows user to type and send a message", async () => {
    const user = userEvent.setup();
    const mockResponse = {
      success: true,
      data: {
        message: "Here's your nutrition info",
      },
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(mockResponse),
    });

    render(<FreeChat />);

    const input = screen.getByPlaceholderText("Type a message...");
    const sendButton = screen.getByLabelText("Send");

    await user.type(input, "What did I eat today?");
    await user.click(sendButton);

    // User message should appear
    expect(screen.getByText("What did I eat today?")).toBeInTheDocument();

    // Wait for response
    await waitFor(() => {
      expect(screen.getByText("Here's your nutrition info")).toBeInTheDocument();
    });

    // API should have been called
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("displays assistant response after API call", async () => {
    const user = userEvent.setup();
    const mockResponse = {
      success: true,
      data: {
        message: "You had 1500 calories today",
      },
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(mockResponse),
    });

    render(<FreeChat />);

    const input = screen.getByPlaceholderText("Type a message...");
    await user.type(input, "How many calories?");
    await user.click(screen.getByLabelText("Send"));

    await waitFor(() => {
      expect(screen.getByText("You had 1500 calories today")).toBeInTheDocument();
    });
  });

  it("disables input and shows warning at 30-message limit", async () => {
    const user = userEvent.setup();

    // Mock successful responses
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      ok: true,
      text: async () => JSON.stringify({ success: true, data: { message: "Response" } }),
    }));

    render(<FreeChat />);

    const input = screen.getByPlaceholderText("Type a message...");

    // Send 15 user messages (+ 15 assistant responses = 30 API messages + 1 initial = 31 total, but limit is 30)
    for (let i = 0; i < 15; i++) {
      if (i > 0) await user.clear(input);
      await user.type(input, `Message ${i + 1}`);
      await user.click(screen.getByLabelText("Send"));
      await waitFor(() => {
        expect(screen.getAllByText("Response")).toHaveLength(i + 1);
      });
    }

    // At 31 messages (1 initial + 15 user + 15 assistant), input should be disabled
    // But actually the limit is 30, so after 15 exchanges (30 API messages), it should be disabled
    await waitFor(() => {
      expect(input).toBeDisabled();
    });

    // Warning should be shown
    expect(screen.getByTestId("limit-warning")).toHaveTextContent(/limit reached/i);
  });

  it("shows near-limit warning at 26+ messages", async () => {
    const user = userEvent.setup();

    // Mock successful responses
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      ok: true,
      text: async () => JSON.stringify({ success: true, data: { message: "Response" } }),
    }));

    render(<FreeChat />);

    const input = screen.getByPlaceholderText("Type a message...");

    // Send 13 user messages (+ 13 assistant = 26 API messages + 1 initial = 27 total)
    for (let i = 0; i < 13; i++) {
      if (i > 0) await user.clear(input);
      await user.type(input, `Message ${i + 1}`);
      await user.click(screen.getByLabelText("Send"));
      await waitFor(() => {
        expect(screen.getAllByText("Response")).toHaveLength(i + 1);
      });
    }

    // Warning should appear
    await waitFor(() => {
      const warning = screen.getByTestId("limit-warning");
      expect(warning).toHaveTextContent(/4 messages remaining/i);
    });
  });

  it("disables send button when input is empty", () => {
    render(<FreeChat />);

    const sendButton = screen.getByLabelText("Send");
    expect(sendButton).toBeDisabled();
  });

  it("disables send button when loading", async () => {
    const user = userEvent.setup();

    // Mock a slow response
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                text: async () => JSON.stringify({ success: true, data: { message: "Response" } }),
              }),
            100
          )
        )
    );

    render(<FreeChat />);

    const input = screen.getByPlaceholderText("Type a message...");
    const sendButton = screen.getByLabelText("Send");

    await user.type(input, "Test message");
    await user.click(sendButton);

    // Send button should be disabled while loading
    expect(sendButton).toBeDisabled();
  });

  it("navigates back to /app when back button is clicked", async () => {
    const user = userEvent.setup();

    render(<FreeChat />);

    const backButton = screen.getByLabelText("Back");
    await user.click(backButton);

    expect(mockPush).toHaveBeenCalledWith("/app");
  });

  it("displays error message when API call fails", async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      text: async () =>
        JSON.stringify({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
        }),
    });

    render(<FreeChat />);

    const input = screen.getByPlaceholderText("Type a message...");
    await user.type(input, "Test");
    await user.click(screen.getByLabelText("Send"));

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });

  it("removes user message and restores input on API error for retry", async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      text: async () =>
        JSON.stringify({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Server error" },
        }),
    });

    render(<FreeChat />);

    const input = screen.getByPlaceholderText("Type a message...");
    await user.type(input, "My test message");
    await user.click(screen.getByLabelText("Send"));

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });

    // User message should be removed (only initial greeting remains)
    expect(screen.queryByText("My test message")).not.toBeInTheDocument();

    // Input should be restored for easy retry
    expect(input).toHaveValue("My test message");
  });
});
