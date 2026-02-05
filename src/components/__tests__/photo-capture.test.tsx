import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhotoCapture } from "../photo-capture";

// Mock URL.createObjectURL
const mockCreateObjectURL = vi.fn();
const mockRevokeObjectURL = vi.fn();
vi.stubGlobal("URL", {
  createObjectURL: mockCreateObjectURL,
  revokeObjectURL: mockRevokeObjectURL,
});

function createMockFile(
  name: string,
  type: string,
  sizeInBytes: number
): File {
  const buffer = new ArrayBuffer(Math.min(sizeInBytes, 100));
  const file = new File([buffer], name, { type });
  // Override size for testing
  if (sizeInBytes > 100) {
    Object.defineProperty(file, "size", {
      value: sizeInBytes,
      writable: false,
    });
  }
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateObjectURL.mockImplementation((file: File) => `blob:${file.name}`);
});

describe("PhotoCapture", () => {
  it("renders file input with accept and capture attributes", () => {
    const onPhotosChange = vi.fn();
    render(<PhotoCapture onPhotosChange={onPhotosChange} />);

    const input = screen.getByTestId("photo-input");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
    expect(input).toHaveAttribute("type", "file");
  });

  it("displays preview thumbnails for selected photos", async () => {
    const onPhotosChange = vi.fn();
    render(<PhotoCapture onPhotosChange={onPhotosChange} />);

    const input = screen.getByTestId("photo-input");
    const files = [
      createMockFile("test1.jpg", "image/jpeg", 1000),
      createMockFile("test2.jpg", "image/jpeg", 1000),
    ];

    fireEvent.change(input, { target: { files } });

    // Should display preview images
    const previews = screen.getAllByRole("img");
    expect(previews).toHaveLength(2);
    expect(previews[0]).toHaveAttribute("src", "blob:test1.jpg");
    expect(previews[1]).toHaveAttribute("src", "blob:test2.jpg");
  });

  it("limits selection to maxPhotos (default 3)", async () => {
    const onPhotosChange = vi.fn();
    render(<PhotoCapture onPhotosChange={onPhotosChange} />);

    const input = screen.getByTestId("photo-input");
    const files = [
      createMockFile("test1.jpg", "image/jpeg", 1000),
      createMockFile("test2.jpg", "image/jpeg", 1000),
      createMockFile("test3.jpg", "image/jpeg", 1000),
      createMockFile("test4.jpg", "image/jpeg", 1000),
    ];

    fireEvent.change(input, { target: { files } });

    // Should only show 3 previews
    const previews = screen.getAllByRole("img");
    expect(previews).toHaveLength(3);

    // Should call onPhotosChange with only 3 files
    expect(onPhotosChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "test1.jpg" }),
        expect.objectContaining({ name: "test2.jpg" }),
        expect.objectContaining({ name: "test3.jpg" }),
      ])
    );
    expect(onPhotosChange.mock.calls[0][0]).toHaveLength(3);
  });

  it("respects custom maxPhotos prop", async () => {
    const onPhotosChange = vi.fn();
    render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={2} />);

    const input = screen.getByTestId("photo-input");
    const files = [
      createMockFile("test1.jpg", "image/jpeg", 1000),
      createMockFile("test2.jpg", "image/jpeg", 1000),
      createMockFile("test3.jpg", "image/jpeg", 1000),
    ];

    fireEvent.change(input, { target: { files } });

    // Should only show 2 previews
    const previews = screen.getAllByRole("img");
    expect(previews).toHaveLength(2);
  });

  it("shows validation error for invalid file types", async () => {
    const onPhotosChange = vi.fn();
    render(<PhotoCapture onPhotosChange={onPhotosChange} />);

    const input = screen.getByTestId("photo-input");
    const files = [createMockFile("test.gif", "image/gif", 1000)];

    fireEvent.change(input, { target: { files } });

    // Should show error message
    expect(screen.getByText(/JPEG|PNG/i)).toBeInTheDocument();
    // Should not call onPhotosChange with invalid files
    expect(onPhotosChange).not.toHaveBeenCalled();
  });

  it("shows validation error for files over 10MB", async () => {
    const onPhotosChange = vi.fn();
    render(<PhotoCapture onPhotosChange={onPhotosChange} />);

    const input = screen.getByTestId("photo-input");
    const files = [createMockFile("large.jpg", "image/jpeg", 11 * 1024 * 1024)];

    fireEvent.change(input, { target: { files } });

    // Should show error message about size
    expect(screen.getByText(/10MB/i)).toBeInTheDocument();
    // Should not call onPhotosChange with oversized files
    expect(onPhotosChange).not.toHaveBeenCalled();
  });

  it("clear button removes all selected photos", async () => {
    const onPhotosChange = vi.fn();
    render(<PhotoCapture onPhotosChange={onPhotosChange} />);

    const input = screen.getByTestId("photo-input");
    const files = [
      createMockFile("test1.jpg", "image/jpeg", 1000),
      createMockFile("test2.jpg", "image/jpeg", 1000),
    ];

    fireEvent.change(input, { target: { files } });

    // Verify photos are displayed
    expect(screen.getAllByRole("img")).toHaveLength(2);

    // Click clear button
    const clearButton = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearButton);

    // Should have no previews
    expect(screen.queryAllByRole("img")).toHaveLength(0);

    // Should call onPhotosChange with empty array
    expect(onPhotosChange).toHaveBeenLastCalledWith([]);
  });

  it("calls onPhotosChange with selected files", async () => {
    const onPhotosChange = vi.fn();
    render(<PhotoCapture onPhotosChange={onPhotosChange} />);

    const input = screen.getByTestId("photo-input");
    const files = [
      createMockFile("test1.jpg", "image/jpeg", 1000),
      createMockFile("test2.png", "image/png", 1000),
    ];

    fireEvent.change(input, { target: { files } });

    expect(onPhotosChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "test1.jpg", type: "image/jpeg" }),
        expect.objectContaining({ name: "test2.png", type: "image/png" }),
      ])
    );
  });

  it("allows adding more photos up to the limit", async () => {
    const onPhotosChange = vi.fn();
    render(<PhotoCapture onPhotosChange={onPhotosChange} />);

    const input = screen.getByTestId("photo-input");

    // Add first photo
    fireEvent.change(input, {
      target: { files: [createMockFile("test1.jpg", "image/jpeg", 1000)] },
    });
    expect(screen.getAllByRole("img")).toHaveLength(1);

    // Add second photo
    fireEvent.change(input, {
      target: { files: [createMockFile("test2.jpg", "image/jpeg", 1000)] },
    });
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
});
