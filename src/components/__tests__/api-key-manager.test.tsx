import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiKeyManager } from "../api-key-manager";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const mockMutate = vi.fn();
const mockUseSWR = vi.fn();

vi.mock("swr", () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

// Ensure navigator.clipboard exists
if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: vi.fn(() => Promise.resolve()),
    },
    writable: true,
    configurable: true,
  });
}

global.fetch = vi.fn();

describe("ApiKeyManager", () => {
  let writeTextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on the clipboard writeText method
    writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

    mockMutate.mockClear();
    mockUseSWR.mockClear();
    if (global.fetch) {
      (global.fetch as ReturnType<typeof vi.fn>).mockClear();
    }
    mockUseSWR.mockReturnValue({
      data: { keys: [] },
      error: null,
      mutate: mockMutate,
    });
  });

  it("renders a Generate API Key button", () => {
    render(<ApiKeyManager />);
    expect(screen.getByRole("button", { name: /Generate API Key/i })).toBeInTheDocument();
  });

  it("shows No API keys message when list is empty", () => {
    render(<ApiKeyManager />);
    expect(screen.getByText(/No API keys/i)).toBeInTheDocument();
  });

  it("shows name input when generate button is clicked", async () => {
    const user = userEvent.setup();
    render(<ApiKeyManager />);

    const generateButton = screen.getByRole("button", { name: /Generate API Key/i });
    await user.click(generateButton);

    expect(screen.getByLabelText(/Key Name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create/i })).toBeInTheDocument();
  });

  it("displays the raw key with copy button after submitting name", async () => {
    const user = userEvent.setup();
    const mockCreatedKey = {
      id: 1,
      name: "My Script",
      rawKey: "fsk_abc123def456",
      keyPrefix: "abc12345",
      createdAt: "2026-01-15T10:00:00.000Z",
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockCreatedKey }),
    });

    render(<ApiKeyManager />);

    const generateButton = screen.getByRole("button", { name: /Generate API Key/i });
    await user.click(generateButton);

    const nameInput = screen.getByLabelText(/Key Name/i);
    await user.type(nameInput, "My Script");

    const createButton = screen.getByRole("button", { name: /Create/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(screen.getByText("fsk_abc123def456")).toBeInTheDocument();
    });

    expect(screen.getByText(/only be shown once/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy/i })).toBeInTheDocument();
  });

  it("adds the new key to the list after dismissing raw key display", async () => {
    const user = userEvent.setup();
    const mockCreatedKey = {
      id: 1,
      name: "My Script",
      rawKey: "fsk_abc123def456",
      keyPrefix: "abc12345",
      createdAt: "2026-01-15T10:00:00.000Z",
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockCreatedKey }),
    });

    mockUseSWR.mockReturnValueOnce({
      data: { keys: [] },
      error: null,
      mutate: mockMutate,
    });

    const { unmount } = render(<ApiKeyManager />);

    const generateButton = screen.getByRole("button", { name: /Generate API Key/i });
    await user.click(generateButton);

    const nameInput = screen.getByLabelText(/Key Name/i);
    await user.type(nameInput, "My Script");

    const createButton = screen.getByRole("button", { name: /Create/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(screen.getByText("fsk_abc123def456")).toBeInTheDocument();
    });

    const doneButton = screen.getByRole("button", { name: /Done/i });
    await user.click(doneButton);

    // Wait for dialog to close
    await waitFor(() => {
      expect(screen.queryByText("fsk_abc123def456")).not.toBeInTheDocument();
    });

    // Verify mutate was called
    expect(mockMutate).toHaveBeenCalled();

    // Clean up before re-rendering
    unmount();

    // Mock the updated SWR data after mutation
    mockUseSWR.mockReturnValue({
      data: {
        keys: [
          {
            id: 1,
            name: "My Script",
            keyPrefix: "abc12345",
            createdAt: "2026-01-15T10:00:00.000Z",
            lastUsedAt: null,
          },
        ],
      },
      error: null,
      mutate: mockMutate,
    });

    // Re-render with updated data
    render(<ApiKeyManager />);

    expect(screen.getByText("My Script")).toBeInTheDocument();
    expect(screen.getByText(/fsk_abc12345/i)).toBeInTheDocument();
  });

  it("displays existing keys with name, prefix, and creation date", () => {
    mockUseSWR.mockReturnValue({
      data: {
        keys: [
          {
            id: 1,
            name: "Script 1",
            keyPrefix: "abc12345",
            createdAt: "2026-01-15T10:00:00.000Z",
            lastUsedAt: null,
          },
          {
            id: 2,
            name: "Script 2",
            keyPrefix: "def67890",
            createdAt: "2026-01-16T11:00:00.000Z",
            lastUsedAt: "2026-01-17T12:00:00.000Z",
          },
        ],
      },
      error: null,
      mutate: mockMutate,
    });

    render(<ApiKeyManager />);

    expect(screen.getByText("Script 1")).toBeInTheDocument();
    expect(screen.getByText(/fsk_abc12345/i)).toBeInTheDocument();
    expect(screen.getByText("Script 2")).toBeInTheDocument();
    expect(screen.getByText(/fsk_def67890/i)).toBeInTheDocument();
  });

  it("each key has a Revoke button", () => {
    mockUseSWR.mockReturnValue({
      data: {
        keys: [
          {
            id: 1,
            name: "Script 1",
            keyPrefix: "abc12345",
            createdAt: "2026-01-15T10:00:00.000Z",
            lastUsedAt: null,
          },
        ],
      },
      error: null,
      mutate: mockMutate,
    });

    render(<ApiKeyManager />);

    const revokeButtons = screen.getAllByRole("button", { name: /Revoke/i });
    expect(revokeButtons).toHaveLength(1);
  });

  it("shows confirmation dialog when Revoke is clicked", async () => {
    const user = userEvent.setup();
    mockUseSWR.mockReturnValue({
      data: {
        keys: [
          {
            id: 1,
            name: "Script 1",
            keyPrefix: "abc12345",
            createdAt: "2026-01-15T10:00:00.000Z",
            lastUsedAt: null,
          },
        ],
      },
      error: null,
      mutate: mockMutate,
    });

    render(<ApiKeyManager />);

    const revokeButton = screen.getByRole("button", { name: /Revoke/i });
    await user.click(revokeButton);

    expect(screen.getByText(/Are you sure/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeInTheDocument();
  });

  it("removes key from list after confirming revocation", async () => {
    const user = userEvent.setup();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { revoked: true } }),
    });

    mockUseSWR.mockReturnValueOnce({
      data: {
        keys: [
          {
            id: 1,
            name: "Script 1",
            keyPrefix: "abc12345",
            createdAt: "2026-01-15T10:00:00.000Z",
            lastUsedAt: null,
          },
        ],
      },
      error: null,
      mutate: mockMutate,
    });

    render(<ApiKeyManager />);

    const revokeButton = screen.getByRole("button", { name: /Revoke/i });
    await user.click(revokeButton);

    const confirmButton = screen.getByRole("button", { name: /Confirm/i });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/api-keys/1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    expect(mockMutate).toHaveBeenCalled();
  });

  it("copies key to clipboard when Copy button is clicked", async () => {
    const user = userEvent.setup();
    const mockCreatedKey = {
      id: 1,
      name: "My Script",
      rawKey: "fsk_abc123def456",
      keyPrefix: "abc12345",
      createdAt: "2026-01-15T10:00:00.000Z",
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockCreatedKey }),
    });

    render(<ApiKeyManager />);

    const generateButton = screen.getByRole("button", { name: /Generate API Key/i });
    await user.click(generateButton);

    const nameInput = screen.getByLabelText(/Key Name/i);
    await user.type(nameInput, "My Script");

    const createButton = screen.getByRole("button", { name: /Create/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(screen.getByText("fsk_abc123def456")).toBeInTheDocument();
    });

    const copyButton = screen.getByRole("button", { name: /Copy/i });
    await user.click(copyButton);

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith("fsk_abc123def456");
    });
  });
});
