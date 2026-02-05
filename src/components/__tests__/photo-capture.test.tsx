import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PhotoCapture } from "../photo-capture";

// Mock the image module
const mockIsHeicFile = vi.fn();
const mockConvertHeicToJpeg = vi.fn();
vi.mock("@/lib/image", () => ({
  isHeicFile: (...args: unknown[]) => mockIsHeicFile(...args),
  convertHeicToJpeg: (...args: unknown[]) => mockConvertHeicToJpeg(...args),
}));

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
  mockCreateObjectURL.mockImplementation((blob: Blob | File) => {
    if (blob instanceof File) {
      return `blob:${blob.name}`;
    }
    return `blob:converted`;
  });
  // Default: no files are HEIC
  mockIsHeicFile.mockReturnValue(false);
  mockConvertHeicToJpeg.mockResolvedValue(new Blob(["converted"], { type: "image/jpeg" }));
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

      await waitFor(() => {
        const previews = screen.getAllByRole("img");
        expect(previews).toHaveLength(1);
        expect(previews[0]).toHaveAttribute("src", "blob:camera-photo.jpg");
      });
    });

    it("calls onPhotosChange with camera photos", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input");
      const files = [createMockFile("camera-photo.jpg", "image/jpeg", 1000)];

      fireEvent.change(cameraInput, { target: { files } });

      await waitFor(() => {
        expect(onPhotosChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ name: "camera-photo.jpg" }),
          ])
        );
      });
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

      await waitFor(() => {
        const previews = screen.getAllByRole("img");
        expect(previews).toHaveLength(2);
        expect(previews[0]).toHaveAttribute("src", "blob:gallery1.jpg");
        expect(previews[1]).toHaveAttribute("src", "blob:gallery2.png");
      });
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

      await waitFor(() => {
        expect(onPhotosChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ name: "gallery1.jpg", type: "image/jpeg" }),
            expect.objectContaining({ name: "gallery2.png", type: "image/png" }),
          ])
        );
      });
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
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      // Add photos from gallery
      fireEvent.change(galleryInput, {
        target: {
          files: [
            createMockFile("gallery1.jpg", "image/jpeg", 1000),
            createMockFile("gallery2.jpg", "image/jpeg", 1000),
          ],
        },
      });
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(3);
      });

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
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
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
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(2);
        expect(onPhotosChange.mock.calls.at(-1)?.[0]).toHaveLength(2);
      });
    });
  });

  describe("shared validation", () => {
    it("accepts GIF files (image/gif)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("test.gif", "image/gif", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(onPhotosChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ name: "test.gif", type: "image/gif" }),
          ])
        );
      });
    });

    it("accepts WebP files (image/webp)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("test.webp", "image/webp", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(onPhotosChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ name: "test.webp", type: "image/webp" }),
          ])
        );
      });
    });

    it("accepts HEIC files (image/heic)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("test.heic", "image/heic", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(onPhotosChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ name: "test.heic", type: "image/heic" }),
          ])
        );
      });
    });

    it("accepts HEIF files (image/heif)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("test.heif", "image/heif", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(onPhotosChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ name: "test.heif", type: "image/heif" }),
          ])
        );
      });
    });

    it("accepts .heic files with empty MIME type (Android fallback)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      // Android sometimes reports empty MIME type for HEIC files
      const files = [createMockFile("photo.heic", "", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(onPhotosChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ name: "photo.heic" }),
          ])
        );
      });
    });

    it("shows validation error for unsupported file types", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input");
      const files = [createMockFile("test.bmp", "image/bmp", 1000)];

      fireEvent.change(cameraInput, { target: { files } });

      // Validation happens synchronously before async processing
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

      // Validation happens synchronously before async processing
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

      // Validation happens synchronously before async processing
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
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      // Add photo from gallery
      fireEvent.change(galleryInput, {
        target: { files: [createMockFile("gallery.jpg", "image/jpeg", 1000)] },
      });
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(2);
      });

      // Click clear button - with 2+ photos, shows confirmation
      const clearButton = screen.getByRole("button", { name: /clear/i });
      fireEvent.click(clearButton);

      // Confirm the clear action
      await waitFor(() => {
        const confirmButton = screen.getByRole("button", { name: /confirm/i });
        fireEvent.click(confirmButton);
      });

      // Should have no previews
      await waitFor(() => {
        expect(screen.queryAllByRole("img")).toHaveLength(0);
      });
      expect(onPhotosChange).toHaveBeenLastCalledWith([]);
    });

    it("clears immediately with 1 photo (no confirmation)", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input");

      // Add just 1 photo
      fireEvent.change(cameraInput, {
        target: { files: [createMockFile("camera.jpg", "image/jpeg", 1000)] },
      });
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      // Click clear button - with 1 photo, clears immediately
      const clearButton = screen.getByRole("button", { name: /clear/i });
      fireEvent.click(clearButton);

      // Should clear immediately without confirmation
      await waitFor(() => {
        expect(screen.queryAllByRole("img")).toHaveLength(0);
      });
      expect(onPhotosChange).toHaveBeenLastCalledWith([]);
    });

    it("shows confirmation dialog with 2+ photos", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");

      // Add 2 photos at once
      fireEvent.change(galleryInput, {
        target: {
          files: [
            createMockFile("photo1.jpg", "image/jpeg", 1000),
            createMockFile("photo2.jpg", "image/jpeg", 1000),
          ],
        },
      });
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(2);
      });

      // Click clear button
      const clearButton = screen.getByRole("button", { name: /clear/i });
      fireEvent.click(clearButton);

      // Should show confirmation dialog
      await waitFor(() => {
        expect(screen.getByText(/clear all photos/i)).toBeInTheDocument();
      });
    });

    it("canceling confirmation keeps photos", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");

      // Add 2 photos
      fireEvent.change(galleryInput, {
        target: {
          files: [
            createMockFile("photo1.jpg", "image/jpeg", 1000),
            createMockFile("photo2.jpg", "image/jpeg", 1000),
          ],
        },
      });
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(2);
      });

      // Click clear button
      const clearButton = screen.getByRole("button", { name: /clear/i });
      fireEvent.click(clearButton);

      // Cancel the clear action
      await waitFor(() => {
        const cancelButton = screen.getByRole("button", { name: /cancel/i });
        fireEvent.click(cancelButton);
      });

      // Photos should still be there
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(2);
      });
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
      await waitFor(() => {
        expect(screen.getByText("1/3 photos selected")).toBeInTheDocument();
      });
    });
  });

  describe("HEIC preview handling", () => {
    it("converts HEIC files to JPEG for preview", async () => {
      const onPhotosChange = vi.fn();
      const convertedBlob = new Blob(["converted jpeg"], { type: "image/jpeg" });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockResolvedValue(convertedBlob);
      mockCreateObjectURL.mockImplementation((blob: Blob) => {
        if (blob === convertedBlob) {
          return "blob:converted-heic";
        }
        return `blob:original`;
      });

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      // Wait for async conversion to complete
      await waitFor(() => {
        expect(mockConvertHeicToJpeg).toHaveBeenCalledWith(heicFile);
      });

      // Preview should render with converted blob URL
      await waitFor(() => {
        const preview = screen.getByAltText("Preview 1");
        expect(preview).toBeInTheDocument();
        expect(preview).toHaveAttribute("src", "blob:converted-heic");
      });
    });

    it("does not convert non-HEIC files for preview", async () => {
      const onPhotosChange = vi.fn();
      mockIsHeicFile.mockReturnValue(false);

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const jpegFile = createMockFile("photo.jpg", "image/jpeg", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [jpegFile] } });

      // Wait for state update
      await waitFor(() => {
        expect(screen.getByAltText("Preview 1")).toBeInTheDocument();
      });

      // Should NOT have called conversion
      expect(mockConvertHeicToJpeg).not.toHaveBeenCalled();
    });

    it("handles mix of HEIC and non-HEIC files", async () => {
      const onPhotosChange = vi.fn();
      const convertedBlob = new Blob(["converted"], { type: "image/jpeg" });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockResolvedValue(convertedBlob);

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const jpegFile = createMockFile("photo.jpg", "image/jpeg", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile, jpegFile] } });

      // Wait for async conversion to complete
      await waitFor(() => {
        expect(mockConvertHeicToJpeg).toHaveBeenCalledTimes(1);
        expect(mockConvertHeicToJpeg).toHaveBeenCalledWith(heicFile);
      });

      // Both previews should render
      await waitFor(() => {
        expect(screen.getByAltText("Preview 1")).toBeInTheDocument();
        expect(screen.getByAltText("Preview 2")).toBeInTheDocument();
      });
    });

    it("still passes original HEIC files to onPhotosChange (not converted blobs)", async () => {
      const onPhotosChange = vi.fn();
      const convertedBlob = new Blob(["converted"], { type: "image/jpeg" });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockResolvedValue(convertedBlob);

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      // Wait for async conversion
      await waitFor(() => {
        expect(mockConvertHeicToJpeg).toHaveBeenCalled();
      });

      // onPhotosChange should receive the original File, not the converted Blob
      // (conversion for upload happens separately in FoodAnalyzer)
      await waitFor(() => {
        expect(onPhotosChange).toHaveBeenCalledWith([heicFile]);
      });
    });

    it("shows error message when HEIC conversion fails", async () => {
      const onPhotosChange = vi.fn();
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockRejectedValue(new Error("Conversion failed"));

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      // Should show error message
      await waitFor(() => {
        expect(screen.getByText(/failed to process heic/i)).toBeInTheDocument();
      });

      // onPhotosChange should NOT have been called
      expect(onPhotosChange).not.toHaveBeenCalled();

      // No previews should be shown
      expect(screen.queryAllByRole("img")).toHaveLength(0);
    });
  });

  describe("processing state", () => {
    it("shows loading placeholder immediately when selecting HEIC file", async () => {
      const onPhotosChange = vi.fn();
      // Make convertHeicToJpeg not resolve immediately - use a deferred promise
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      // Placeholder should appear before conversion completes
      await waitFor(() => {
        expect(screen.getByTestId("processing-placeholder")).toBeInTheDocument();
      });

      // Now resolve the conversion
      resolveConversion!(new Blob(["converted"], { type: "image/jpeg" }));

      // After conversion, placeholder should be gone and preview should appear
      await waitFor(() => {
        expect(screen.queryByTestId("processing-placeholder")).not.toBeInTheDocument();
        expect(screen.getByAltText("Preview 1")).toBeInTheDocument();
      });
    });

    it("shows spinner inside loading placeholder", async () => {
      const onPhotosChange = vi.fn();
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      // Placeholder should contain a spinner
      await waitFor(() => {
        const placeholder = screen.getByTestId("processing-placeholder");
        expect(placeholder.querySelector(".animate-spin")).toBeInTheDocument();
      });

      // Cleanup
      resolveConversion!(new Blob(["converted"], { type: "image/jpeg" }));
    });

    it("replaces loading placeholder with actual preview when conversion completes", async () => {
      const onPhotosChange = vi.fn();
      const convertedBlob = new Blob(["converted"], { type: "image/jpeg" });
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);
      mockCreateObjectURL.mockImplementation(() => "blob:converted-heic");

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      // Placeholder visible during processing
      await waitFor(() => {
        expect(screen.getByTestId("processing-placeholder")).toBeInTheDocument();
      });

      // Resolve conversion
      resolveConversion!(convertedBlob);

      // Placeholder gone, actual preview visible
      await waitFor(() => {
        expect(screen.queryByTestId("processing-placeholder")).not.toBeInTheDocument();
        const preview = screen.getByAltText("Preview 1");
        expect(preview).toBeInTheDocument();
        expect(preview).toHaveAttribute("src", "blob:converted-heic");
      });
    });

    it("shows correct number of placeholders for multiple files", async () => {
      const onPhotosChange = vi.fn();
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile1 = createMockFile("photo1.heic", "image/heic", 1000);
      const heicFile2 = createMockFile("photo2.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile1, heicFile2] } });

      // Should show 2 placeholders
      await waitFor(() => {
        const placeholders = screen.getAllByTestId("processing-placeholder");
        expect(placeholders).toHaveLength(2);
      });

      // Cleanup
      resolveConversion!(new Blob(["converted"], { type: "image/jpeg" }));
    });

    it("shows placeholders for all new files during processing (HEIC + JPEG)", async () => {
      const onPhotosChange = vi.fn();
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const jpegFile = createMockFile("photo.jpg", "image/jpeg", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile, jpegFile] } });

      // All new files show placeholders during async processing (Promise.all waits for all)
      await waitFor(() => {
        const placeholders = screen.getAllByTestId("processing-placeholder");
        expect(placeholders).toHaveLength(2);
      });

      // Cleanup
      resolveConversion!(new Blob(["converted"], { type: "image/jpeg" }));
    });

    it("loading placeholder has proper accessibility attributes", async () => {
      const onPhotosChange = vi.fn();
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      // Verify accessibility attributes
      await waitFor(() => {
        const placeholder = screen.getByTestId("processing-placeholder");
        expect(placeholder).toHaveAttribute("aria-busy", "true");
        expect(placeholder).toHaveAttribute("aria-label", "Processing photo");
      });

      // Cleanup
      resolveConversion!(new Blob(["converted"], { type: "image/jpeg" }));
    });

    it("shows correct placeholder count when adding to existing photos", async () => {
      const onPhotosChange = vi.fn();
      mockIsHeicFile.mockReturnValue(false);

      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={3} />);

      // First, add a JPEG (no processing delay needed)
      const jpegFile = createMockFile("existing.jpg", "image/jpeg", 1000);
      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, { target: { files: [jpegFile] } });

      await waitFor(() => {
        expect(screen.getByAltText("Preview 1")).toBeInTheDocument();
      });

      // Now set up a slow HEIC conversion
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);

      // Add a HEIC file
      const heicFile = createMockFile("new.heic", "image/heic", 1000);
      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      // Should show only 1 placeholder (for the new file), not 2
      await waitFor(() => {
        const placeholders = screen.getAllByTestId("processing-placeholder");
        expect(placeholders).toHaveLength(1);
      });

      // Existing preview should still be there
      expect(screen.getByAltText("Preview 1")).toBeInTheDocument();

      // Cleanup
      resolveConversion!(new Blob(["converted"], { type: "image/jpeg" }));
    });

    it("ignores new selections while processing to prevent race conditions", async () => {
      const onPhotosChange = vi.fn();
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);

      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={3} />);

      const heicFile = createMockFile("first.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      // Start processing first file
      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      await waitFor(() => {
        expect(screen.getByTestId("processing-placeholder")).toBeInTheDocument();
      });

      // Try to add another file while processing
      const secondFile = createMockFile("second.jpg", "image/jpeg", 1000);
      fireEvent.change(galleryInput, { target: { files: [secondFile] } });

      // Should still only have 1 placeholder (second selection was ignored)
      const placeholders = screen.getAllByTestId("processing-placeholder");
      expect(placeholders).toHaveLength(1);

      // Complete the first conversion
      resolveConversion!(new Blob(["converted"], { type: "image/jpeg" }));

      // After processing completes, should have only the first file
      await waitFor(() => {
        expect(screen.queryByTestId("processing-placeholder")).not.toBeInTheDocument();
        expect(screen.getByAltText("Preview 1")).toBeInTheDocument();
      });

      // onPhotosChange should only have been called with the first file
      expect(onPhotosChange).toHaveBeenLastCalledWith([heicFile]);
    });

    it("clears processing count on HEIC conversion error", async () => {
      const onPhotosChange = vi.fn();
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockRejectedValue(new Error("Conversion failed"));

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      // Wait for error to be displayed
      await waitFor(() => {
        expect(screen.getByText(/failed to process heic/i)).toBeInTheDocument();
      });

      // Placeholder should be cleared after error
      expect(screen.queryByTestId("processing-placeholder")).not.toBeInTheDocument();
    });
  });

  describe("photo preview zoom", () => {
    it("opens full-screen dialog when tapping preview", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("photo.jpg", "image/jpeg", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      // Click on the preview image
      const previewImage = screen.getByAltText("Preview 1");
      fireEvent.click(previewImage);

      // Should open a dialog with the full-screen image
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
    });

    it("shows close button in full-screen dialog", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("photo.jpg", "image/jpeg", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      // Click on the preview image
      const previewImage = screen.getByAltText("Preview 1");
      fireEvent.click(previewImage);

      // Should show close button
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
      });
    });

    it("closes dialog when clicking close button", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [createMockFile("photo.jpg", "image/jpeg", 1000)];

      fireEvent.change(galleryInput, { target: { files } });

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      // Click on the preview image
      const previewImage = screen.getByAltText("Preview 1");
      fireEvent.click(previewImage);

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Click close button
      const closeButton = screen.getByRole("button", { name: /close/i });
      fireEvent.click(closeButton);

      // Dialog should be closed
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });
  });
});
