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
  describe("dual input structure", () => {
    it("renders 'Take Photo' button", () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const takePhotoButton = screen.getByRole("button", {
        name: /take photo/i,
      });
      expect(takePhotoButton).toBeInTheDocument();
    });

    it("renders 'Choose from Gallery' button", () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryButton = screen.getByRole("button", {
        name: /choose from gallery/i,
      });
      expect(galleryButton).toBeInTheDocument();
    });

    it("renders hidden camera input with capture='environment' attribute", () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input");
      expect(cameraInput).toHaveAttribute("capture", "environment");
      expect(cameraInput).toHaveAttribute(
        "accept",
        "image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
      );
      expect(cameraInput).toHaveAttribute("type", "file");
      expect(cameraInput).toHaveClass("hidden");
    });

    it("renders hidden gallery input without capture attribute", () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      expect(galleryInput).not.toHaveAttribute("capture");
      expect(galleryInput).toHaveAttribute(
        "accept",
        "image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
      );
      expect(galleryInput).toHaveAttribute("type", "file");
      expect(galleryInput).toHaveClass("hidden");
    });

    it("'Take Photo' button triggers camera input click", () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input") as HTMLInputElement;
      const clickSpy = vi.spyOn(cameraInput, "click");

      const takePhotoButton = screen.getByRole("button", {
        name: /take photo/i,
      });
      fireEvent.click(takePhotoButton);

      expect(clickSpy).toHaveBeenCalled();
    });

    it("'Choose from Gallery' button triggers gallery input click", () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input") as HTMLInputElement;
      const clickSpy = vi.spyOn(galleryInput, "click");

      const galleryButton = screen.getByRole("button", {
        name: /choose from gallery/i,
      });
      fireEvent.click(galleryButton);

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe("photo selection from camera", () => {
    it("displays preview thumbnails for photos taken with camera", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input");
      const files = [createMockFile("camera-photo.jpg", "image/jpeg", 1000)];

      fireEvent.change(cameraInput, { target: { files } });

      const previews = screen.getAllByRole("img");
      expect(previews).toHaveLength(1);
      expect(previews[0]).toHaveAttribute("src", "blob:camera-photo.jpg");
    });

    it("calls onPhotosChange with camera photos", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input");
      const files = [createMockFile("camera-photo.jpg", "image/jpeg", 1000)];

      fireEvent.change(cameraInput, { target: { files } });

      expect(onPhotosChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "camera-photo.jpg" }),
        ])
      );
    });
  });

  describe("photo selection from gallery", () => {
    it("displays preview thumbnails for photos from gallery", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [
        createMockFile("gallery1.jpg", "image/jpeg", 1000),
        createMockFile("gallery2.png", "image/png", 1000),
      ];

      fireEvent.change(galleryInput, { target: { files } });

      const previews = screen.getAllByRole("img");
      expect(previews).toHaveLength(2);
      expect(previews[0]).toHaveAttribute("src", "blob:gallery1.jpg");
      expect(previews[1]).toHaveAttribute("src", "blob:gallery2.png");
    });

    it("calls onPhotosChange with gallery photos", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [
        createMockFile("gallery1.jpg", "image/jpeg", 1000),
        createMockFile("gallery2.png", "image/png", 1000),
      ];

      fireEvent.change(galleryInput, { target: { files } });

      expect(onPhotosChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "gallery1.jpg", type: "image/jpeg" }),
          expect.objectContaining({ name: "gallery2.png", type: "image/png" }),
        ])
      );
    });
  });

  describe("combining photos from both sources", () => {
    it("combines photos from camera and gallery up to maxPhotos limit", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={3} />);

      const cameraInput = screen.getByTestId("camera-input");
      const galleryInput = screen.getByTestId("gallery-input");

      // Add photo from camera
      fireEvent.change(cameraInput, {
        target: { files: [createMockFile("camera.jpg", "image/jpeg", 1000)] },
      });
      expect(screen.getAllByRole("img")).toHaveLength(1);

      // Add photos from gallery
      fireEvent.change(galleryInput, {
        target: {
          files: [
            createMockFile("gallery1.jpg", "image/jpeg", 1000),
            createMockFile("gallery2.jpg", "image/jpeg", 1000),
          ],
        },
      });
      expect(screen.getAllByRole("img")).toHaveLength(3);

      // Verify onPhotosChange was called with all 3 photos
      expect(onPhotosChange).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "camera.jpg" }),
          expect.objectContaining({ name: "gallery1.jpg" }),
          expect.objectContaining({ name: "gallery2.jpg" }),
        ])
      );
    });

    it("respects maxPhotos limit when combining from both sources", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={2} />);

      const cameraInput = screen.getByTestId("camera-input");
      const galleryInput = screen.getByTestId("gallery-input");

      // Add photo from camera
      fireEvent.change(cameraInput, {
        target: { files: [createMockFile("camera.jpg", "image/jpeg", 1000)] },
      });

      // Try to add 2 more from gallery (should only add 1)
      fireEvent.change(galleryInput, {
        target: {
          files: [
            createMockFile("gallery1.jpg", "image/jpeg", 1000),
            createMockFile("gallery2.jpg", "image/jpeg", 1000),
          ],
        },
      });

      // Should only have 2 photos (limit)
      expect(screen.getAllByRole("img")).toHaveLength(2);
      expect(onPhotosChange.mock.calls.at(-1)?.[0]).toHaveLength(2);
    });
  });

  describe("shared validation", () => {
    it("accepts GIF files (image/gif)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("test.gif", "image/gif", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onPhotosChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "test.gif", type: "image/gif" }),
        ])
      );
    });

    it("accepts WebP files (image/webp)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("test.webp", "image/webp", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onPhotosChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "test.webp", type: "image/webp" }),
        ])
      );
    });

    it("accepts HEIC files (image/heic)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("test.heic", "image/heic", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onPhotosChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "test.heic", type: "image/heic" }),
        ])
      );
    });

    it("accepts HEIF files (image/heif)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("test.heif", "image/heif", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onPhotosChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "test.heif", type: "image/heif" }),
        ])
      );
    });

    it("accepts .heic files with empty MIME type (Android fallback)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      // Android sometimes reports empty MIME type for HEIC files
      const files = [createMockFile("photo.heic", "", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onPhotosChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "photo.heic" }),
        ])
      );
    });

    it("shows validation error for unsupported file types", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input");
      const files = [createMockFile("test.bmp", "image/bmp", 1000)];

      fireEvent.change(cameraInput, { target: { files } });

      expect(
        screen.getByText(/JPEG.*PNG.*GIF.*WebP.*HEIC/i)
      ).toBeInTheDocument();
      expect(onPhotosChange).not.toHaveBeenCalled();
    });

    it("shows validation error for files over 10MB from camera", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input");
      const files = [
        createMockFile("large.jpg", "image/jpeg", 11 * 1024 * 1024),
      ];

      fireEvent.change(cameraInput, { target: { files } });

      expect(screen.getByText(/10MB/i)).toBeInTheDocument();
      expect(onPhotosChange).not.toHaveBeenCalled();
    });

    it("shows validation error for files over 10MB from gallery", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [
        createMockFile("large.jpg", "image/jpeg", 11 * 1024 * 1024),
      ];

      fireEvent.change(galleryInput, { target: { files } });

      expect(screen.getByText(/10MB/i)).toBeInTheDocument();
      expect(onPhotosChange).not.toHaveBeenCalled();
    });
  });

  describe("clear functionality", () => {
    it("clear button removes all selected photos from both sources", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input");
      const galleryInput = screen.getByTestId("gallery-input");

      // Add photo from camera
      fireEvent.change(cameraInput, {
        target: { files: [createMockFile("camera.jpg", "image/jpeg", 1000)] },
      });

      // Add photo from gallery
      fireEvent.change(galleryInput, {
        target: { files: [createMockFile("gallery.jpg", "image/jpeg", 1000)] },
      });

      expect(screen.getAllByRole("img")).toHaveLength(2);

      // Click clear button
      const clearButton = screen.getByRole("button", { name: /clear/i });
      fireEvent.click(clearButton);

      // Should have no previews
      expect(screen.queryAllByRole("img")).toHaveLength(0);
      expect(onPhotosChange).toHaveBeenLastCalledWith([]);
    });
  });

  describe("photo count display", () => {
    it("displays correct photo count", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={3} />);

      // Initially 0/3
      expect(screen.getByText("0/3 photos selected")).toBeInTheDocument();

      const cameraInput = screen.getByTestId("camera-input");
      fireEvent.change(cameraInput, {
        target: { files: [createMockFile("photo.jpg", "image/jpeg", 1000)] },
      });

      // After adding 1 photo
      expect(screen.getByText("1/3 photos selected")).toBeInTheDocument();
    });
  });
});
