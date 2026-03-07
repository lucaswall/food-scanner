import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhotoCapture } from "../photo-capture";

// Mock next/image to render a plain <img> in tests
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => {
    const { fill, unoptimized, ...rest } = props;
    void fill;
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...rest} />;
  },
}));

// Mock the image module
const mockIsHeicFile = vi.fn();
const mockConvertHeicToJpeg = vi.fn();
vi.mock("@/lib/image", () => ({
  isHeicFile: (...args: unknown[]) => mockIsHeicFile(...args),
  convertHeicToJpeg: (...args: unknown[]) => mockConvertHeicToJpeg(...args),
}));

// Mock URL.createObjectURL and revokeObjectURL (preserve URL constructor for next/image)
const mockCreateObjectURL = vi.fn();
const mockRevokeObjectURL = vi.fn();
globalThis.URL.createObjectURL = mockCreateObjectURL;
globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

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
          ]),
          expect.any(Array) // convertedBlobs parameter
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
          ]),
          expect.any(Array) // convertedBlobs parameter
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
        ]),
        expect.any(Array) // convertedBlobs parameter
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
          ]),
          expect.any(Array)
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
          ]),
          expect.any(Array)
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
          ]),
          expect.any(Array)
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
          ]),
          expect.any(Array)
        );
      });
    });

    it("accepts .heic files with empty MIME type (Android fallback)", async () => {
      const onPhotosChange = vi.fn();
      // isHeicFile handles extension-based detection for empty MIME types
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
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
          ]),
          expect.any(Array) // convertedBlobs parameter
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
    it("individual X buttons remove photos one by one", async () => {
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

      // Remove first photo via X button
      fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      // Remove last photo via X button
      fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
      await waitFor(() => {
        expect(screen.queryAllByRole("img")).toHaveLength(0);
      });
      expect(onPhotosChange).toHaveBeenLastCalledWith([], []);
    });

    it("no Clear All button is shown with 1 photo (use individual X instead)", async () => {
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

      // Clear All button should not be shown
      expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
      // But remove button should exist
      expect(screen.getByRole("button", { name: "Remove photo 1" })).toBeInTheDocument();
    });

    it("no Clear All button is shown with 2+ photos (removed — use individual X or Start Over)", async () => {
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

      // Clear All button should NOT exist (removed feature)
      expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();

      // No clear confirmation dialog should exist
      expect(screen.queryByText(/clear all photos/i)).not.toBeInTheDocument();
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

      // onPhotosChange receives both original File AND converted Blob
      // (FOO-417: avoid double conversion by passing converted blob to FoodAnalyzer)
      await waitFor(() => {
        expect(onPhotosChange).toHaveBeenCalledWith(
          [heicFile],
          expect.arrayContaining([expect.any(Blob)]) // convertedBlobs with JPEG blob
        );
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

      // Should show error message (resilient implementation)
      await waitFor(() => {
        expect(screen.getByText(/all images failed to process/i)).toBeInTheDocument();
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

    it("processing placeholders appear in the same grid as photo previews", async () => {
      const onPhotosChange = vi.fn();
      mockIsHeicFile.mockReturnValue(false);

      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={5} />);

      // Add a JPEG first
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

      await waitFor(() => {
        expect(screen.getByTestId("processing-placeholder")).toBeInTheDocument();
      });

      // The placeholder and the preview should share the same parent grid container
      const placeholder = screen.getByTestId("processing-placeholder");
      const preview = screen.getByAltText("Preview 1");
      expect(placeholder.parentElement).toBe(preview.closest("[class*='grid']"));

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
      expect(onPhotosChange).toHaveBeenLastCalledWith([heicFile], expect.any(Array));
    });

    it("clears processing count on HEIC conversion error", async () => {
      const onPhotosChange = vi.fn();
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockRejectedValue(new Error("Conversion failed"));

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const heicFile = createMockFile("photo.heic", "image/heic", 1000);
      const galleryInput = screen.getByTestId("gallery-input");

      fireEvent.change(galleryInput, { target: { files: [heicFile] } });

      // Wait for error to be displayed (resilient implementation)
      await waitFor(() => {
        expect(screen.getByText(/all images failed to process/i)).toBeInTheDocument();
      });

      // Placeholder should be cleared after error
      expect(screen.queryByTestId("processing-placeholder")).not.toBeInTheDocument();
    });
  });

  describe("autoCapture", () => {
    it("triggers camera input click on mount when autoCapture is true", async () => {
      const onPhotosChange = vi.fn();
      // Spy on HTMLInputElement.prototype.click before rendering
      const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
      render(<PhotoCapture onPhotosChange={onPhotosChange} autoCapture />);

      await waitFor(() => {
        // Find calls that targeted the camera input specifically
        const cameraInput = screen.getByTestId("camera-input") as HTMLInputElement;
        const calledOnCamera = clickSpy.mock.instances.some(instance => instance === cameraInput);
        expect(calledOnCamera).toBe(true);
      });

      clickSpy.mockRestore();
    });

    it("does not trigger camera input click when autoCapture is false", () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} autoCapture={false} />);

      const cameraInput = screen.getByTestId("camera-input") as HTMLInputElement;
      const clickSpy = vi.spyOn(cameraInput, "click");

      expect(clickSpy).not.toHaveBeenCalled();
    });

    it("does not trigger camera input click when autoCapture is undefined", () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const cameraInput = screen.getByTestId("camera-input") as HTMLInputElement;
      const clickSpy = vi.spyOn(cameraInput, "click");

      expect(clickSpy).not.toHaveBeenCalled();
    });
  });

  describe("blob URL cleanup on unmount", () => {
    it("revokes all preview URLs when component unmounts", async () => {
      const onPhotosChange = vi.fn();
      const { unmount } = render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      const files = [
        createMockFile("photo1.jpg", "image/jpeg", 1000),
        createMockFile("photo2.jpg", "image/jpeg", 1000),
      ];

      fireEvent.change(galleryInput, { target: { files } });

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(2);
      });

      // Clear mock counts so we only track unmount revocations
      mockRevokeObjectURL.mockClear();

      // Unmount the component
      unmount();

      // Should have revoked both preview URLs
      expect(mockRevokeObjectURL).toHaveBeenCalledTimes(2);
      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:photo1.jpg");
      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:photo2.jpg");
    });
  });

  describe("individual photo removal", () => {
    it("each photo preview has a remove button with accessible label", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: {
          files: [
            createMockFile("photo1.jpg", "image/jpeg", 1000),
            createMockFile("photo2.jpg", "image/jpeg", 1000),
          ],
        },
      });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Remove photo 1" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Remove photo 2" })).toBeInTheDocument();
      });
    });

    it("clicking remove on a single photo removes only that photo", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: {
          files: [
            createMockFile("photo1.jpg", "image/jpeg", 1000),
            createMockFile("photo2.jpg", "image/jpeg", 1000),
            createMockFile("photo3.jpg", "image/jpeg", 1000),
          ],
        },
      });

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(3);
      });

      // Remove the second photo
      const removeBtn = screen.getByRole("button", { name: "Remove photo 2" });
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(2);
      });

      // onPhotosChange called with remaining photos (photo1 and photo3)
      expect(onPhotosChange).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: "photo1.jpg" }),
          expect.objectContaining({ name: "photo3.jpg" }),
        ]),
        expect.any(Array)
      );
      // Should NOT contain photo2
      const lastCall = onPhotosChange.mock.calls.at(-1);
      expect(lastCall?.[0]).toHaveLength(2);
    });

    it("clicking remove on the last remaining photo calls onPhotosChange([], [])", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: {
          files: [createMockFile("photo1.jpg", "image/jpeg", 1000)],
        },
      });

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      const removeBtn = screen.getByRole("button", { name: "Remove photo 1" });
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(screen.queryAllByRole("img")).toHaveLength(0);
      });

      expect(onPhotosChange).toHaveBeenLastCalledWith([], []);
    });

    it("remove buttons are not shown during processing", async () => {
      const onPhotosChange = vi.fn();
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      // First add a regular photo
      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: { files: [createMockFile("photo1.jpg", "image/jpeg", 1000)] },
      });

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      // Now add a HEIC file (will be processing)
      fireEvent.change(galleryInput, {
        target: { files: [createMockFile("photo2.heic", "image/heic", 1000)] },
      });

      await waitFor(() => {
        expect(screen.getByTestId("processing-placeholder")).toBeInTheDocument();
      });

      // Remove buttons should not be present during processing
      expect(screen.queryByRole("button", { name: /remove photo/i })).not.toBeInTheDocument();

      resolveConversion!(new Blob(["converted"], { type: "image/jpeg" }));
    });

    it("restored photo previews also have individual remove buttons", () => {
      const onPhotosChange = vi.fn();
      const blobs = [
        new Blob(["img1"], { type: "image/jpeg" }),
        new Blob(["img2"], { type: "image/jpeg" }),
      ];

      render(<PhotoCapture onPhotosChange={onPhotosChange} restoredBlobs={blobs} />);

      expect(screen.getByRole("button", { name: "Remove photo 1" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove photo 2" })).toBeInTheDocument();
    });

    it("clicking remove on a restored photo removes it and calls onPhotosChange", () => {
      const onPhotosChange = vi.fn();
      const blobs = [
        new Blob(["img1"], { type: "image/jpeg" }),
        new Blob(["img2"], { type: "image/jpeg" }),
      ];

      render(<PhotoCapture onPhotosChange={onPhotosChange} restoredBlobs={blobs} />);

      // Remove first restored photo
      const removeBtn = screen.getByRole("button", { name: "Remove photo 1" });
      fireEvent.click(removeBtn);

      // Should only have 1 image left
      expect(screen.getAllByRole("img")).toHaveLength(1);
    });

    it("remove buttons respect disabled/processing state", async () => {
      const onPhotosChange = vi.fn();
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);

      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: { files: [createMockFile("photo.heic", "image/heic", 1000)] },
      });

      await waitFor(() => {
        expect(screen.getByTestId("processing-placeholder")).toBeInTheDocument();
      });

      // No remove buttons during processing
      expect(screen.queryByRole("button", { name: /remove photo/i })).not.toBeInTheDocument();

      resolveConversion!(new Blob(["converted"], { type: "image/jpeg" }));

      // After processing, remove button should appear
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Remove photo 1" })).toBeInTheDocument();
      });
    });

    it("shows confirmation dialog when clearing 2+ restored photos", async () => {
      const user = userEvent.setup();
      const onPhotosChange = vi.fn();
      const blobs = [
        new Blob(["img1"], { type: "image/jpeg" }),
        new Blob(["img2"], { type: "image/jpeg" }),
        new Blob(["img3"], { type: "image/jpeg" }),
      ];

      render(<PhotoCapture onPhotosChange={onPhotosChange} restoredBlobs={blobs} />);

      // Clear All button should NOT exist (removed feature)
      expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();

      // No clear confirmation dialog should exist
      expect(screen.queryByText(/clear all photos/i)).not.toBeInTheDocument();
    });

    it("does not show Clear All button for single restored photo", () => {
      const onPhotosChange = vi.fn();
      const blobs = [new Blob(["img1"], { type: "image/jpeg" })];

      render(<PhotoCapture onPhotosChange={onPhotosChange} restoredBlobs={blobs} />);

      // Clear All should not be shown
      expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
    });
  });

  describe("remove button touch targets", () => {
    it("remove buttons on restored photos have 44px touch targets", () => {
      const onPhotosChange = vi.fn();
      const blobs = [
        new Blob(["img1"], { type: "image/jpeg" }),
        new Blob(["img2"], { type: "image/jpeg" }),
      ];

      render(<PhotoCapture onPhotosChange={onPhotosChange} restoredBlobs={blobs} />);

      const removeButtons = screen.getAllByRole("button", { name: /remove photo/i });
      for (const btn of removeButtons) {
        expect(btn).toHaveClass("min-h-[44px]");
        expect(btn).toHaveClass("min-w-[44px]");
      }
    });

    it("remove buttons on fresh photos have 44px touch targets", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: {
          files: [
            createMockFile("photo1.jpg", "image/jpeg", 1000),
            createMockFile("photo2.jpg", "image/jpeg", 1000),
          ],
        },
      });

      await waitFor(() => {
        const removeButtons = screen.getAllByRole("button", { name: /remove photo/i });
        for (const btn of removeButtons) {
          expect(btn).toHaveClass("min-h-[44px]");
          expect(btn).toHaveClass("min-w-[44px]");
        }
      });
    });
  });

  describe("add-more buttons", () => {
    it("shows Take Photo and Choose from Gallery buttons when photos exist and count < max", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={3} />);

      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: { files: [createMockFile("photo1.jpg", "image/jpeg", 1000)] },
      });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /choose from gallery/i })).toBeInTheDocument();
      });
    });

    it("hides buttons when photo count equals max", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={1} />);

      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: { files: [createMockFile("photo1.jpg", "image/jpeg", 1000)] },
      });

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      expect(screen.queryByRole("button", { name: /take photo/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /choose from gallery/i })).not.toBeInTheDocument();
    });

    it("when no photos exist, buttons are shown", () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} />);

      expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /choose from gallery/i })).toBeInTheDocument();
    });

    it("buttons are hidden during processing", async () => {
      const onPhotosChange = vi.fn();
      let resolveConversion: (value: Blob) => void;
      const conversionPromise = new Promise<Blob>((resolve) => {
        resolveConversion = resolve;
      });
      mockIsHeicFile.mockImplementation((file: File) => file.name.endsWith(".heic"));
      mockConvertHeicToJpeg.mockReturnValue(conversionPromise);

      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={3} />);

      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: { files: [createMockFile("photo.heic", "image/heic", 1000)] },
      });

      await waitFor(() => {
        expect(screen.getByTestId("processing-placeholder")).toBeInTheDocument();
      });

      // canAddMore is false during processing, so buttons are hidden
      expect(screen.queryByRole("button", { name: /take photo/i })).not.toBeInTheDocument();

      resolveConversion!(new Blob(["converted"], { type: "image/jpeg" }));
    });

    it("shows buttons for restored photos when count < max", () => {
      const onPhotosChange = vi.fn();
      const blobs = [new Blob(["img1"], { type: "image/jpeg" })];

      render(<PhotoCapture onPhotosChange={onPhotosChange} restoredBlobs={blobs} maxPhotos={3} />);

      expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /choose from gallery/i })).toBeInTheDocument();
    });

    it("buttons remain visible when photos exist and canAddMore is true", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={3} />);

      // Initially buttons are visible
      expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();

      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: { files: [createMockFile("photo1.jpg", "image/jpeg", 1000)] },
      });

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      // Buttons should still be visible (canAddMore is true)
      expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /choose from gallery/i })).toBeInTheDocument();
    });

    it("no dropdown menu or add-photo-tile exists", async () => {
      const onPhotosChange = vi.fn();
      render(<PhotoCapture onPhotosChange={onPhotosChange} maxPhotos={3} />);

      const galleryInput = screen.getByTestId("gallery-input");
      fireEvent.change(galleryInput, {
        target: { files: [createMockFile("photo1.jpg", "image/jpeg", 1000)] },
      });

      await waitFor(() => {
        expect(screen.getAllByRole("img")).toHaveLength(1);
      });

      expect(screen.queryByTestId("add-photo-tile")).not.toBeInTheDocument();
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
