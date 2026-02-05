import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import heic2any from "heic2any";

// Mock heic2any module
vi.mock("heic2any", () => ({
  default: vi.fn(),
}));

const mockedHeic2any = heic2any as Mock;

// We need to mock canvas APIs since jsdom doesn't fully support them
const mockToBlob = vi.fn();
const mockDrawImage = vi.fn();
const mockGetContext = vi.fn();

// Mock HTMLCanvasElement
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: mockGetContext,
  toBlob: mockToBlob,
};

// Mock CanvasRenderingContext2D
const mockContext = {
  drawImage: mockDrawImage,
};

// Mock Image (HTMLImageElement)
class MockImage {
  width = 0;
  height = 0;
  src = "";
  onload: (() => void) | null = null;
  onerror: ((err: Error) => void) | null = null;

  constructor() {
    // Simulate async loading
    setTimeout(() => {
      if (this.onload) this.onload();
    }, 0);
  }
}

// Setup mocks before importing the module
vi.stubGlobal("Image", MockImage);
vi.stubGlobal(
  "document",
  Object.assign({}, document, {
    createElement: vi.fn((tag: string) => {
      if (tag === "canvas") return mockCanvas;
      return document.createElement(tag);
    }),
  })
);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetContext.mockReturnValue(mockContext);
  mockCanvas.width = 0;
  mockCanvas.height = 0;
  mockedHeic2any.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("compressImage", () => {
  it("resizes image to max 1024px dimension (landscape)", async () => {
    // Mock a 2048x1024 landscape image
    vi.stubGlobal(
      "Image",
      class extends MockImage {
        constructor() {
          super();
          this.width = 2048;
          this.height = 1024;
        }
      }
    );

    const mockBlob = new Blob(["test"], { type: "image/jpeg" });
    mockToBlob.mockImplementation((callback: (blob: Blob) => void) => {
      callback(mockBlob);
    });

    const { compressImage } = await import("@/lib/image");
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    await compressImage(file);

    // Canvas should be set to 1024x512 (scaled down by half)
    expect(mockCanvas.width).toBe(1024);
    expect(mockCanvas.height).toBe(512);
  });

  it("resizes image to max 1024px dimension (portrait)", async () => {
    // Mock a 1024x2048 portrait image
    vi.stubGlobal(
      "Image",
      class extends MockImage {
        constructor() {
          super();
          this.width = 1024;
          this.height = 2048;
        }
      }
    );

    const mockBlob = new Blob(["test"], { type: "image/jpeg" });
    mockToBlob.mockImplementation((callback: (blob: Blob) => void) => {
      callback(mockBlob);
    });

    const { compressImage } = await import("@/lib/image");
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    await compressImage(file);

    // Canvas should be set to 512x1024 (scaled down by half)
    expect(mockCanvas.width).toBe(512);
    expect(mockCanvas.height).toBe(1024);
  });

  it("outputs JPEG at 80% quality", async () => {
    vi.stubGlobal(
      "Image",
      class extends MockImage {
        constructor() {
          super();
          this.width = 500;
          this.height = 500;
        }
      }
    );

    const mockBlob = new Blob(["test"], { type: "image/jpeg" });
    mockToBlob.mockImplementation((callback: (blob: Blob) => void) => {
      callback(mockBlob);
    });

    const { compressImage } = await import("@/lib/image");
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    await compressImage(file);

    // Check toBlob was called with JPEG and 0.8 quality
    expect(mockToBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.8
    );
  });

  it("preserves aspect ratio", async () => {
    // Mock a 1600x1200 image (4:3 aspect ratio)
    vi.stubGlobal(
      "Image",
      class extends MockImage {
        constructor() {
          super();
          this.width = 1600;
          this.height = 1200;
        }
      }
    );

    const mockBlob = new Blob(["test"], { type: "image/jpeg" });
    mockToBlob.mockImplementation((callback: (blob: Blob) => void) => {
      callback(mockBlob);
    });

    const { compressImage } = await import("@/lib/image");
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    await compressImage(file);

    // Should scale to 1024x768 (maintaining 4:3 ratio)
    expect(mockCanvas.width).toBe(1024);
    expect(mockCanvas.height).toBe(768);

    // Verify aspect ratio is preserved
    const originalRatio = 1600 / 1200;
    const newRatio = mockCanvas.width / mockCanvas.height;
    expect(newRatio).toBeCloseTo(originalRatio, 2);
  });

  it("handles already-small images without upscaling", async () => {
    // Mock a 500x400 image (already smaller than 1024)
    vi.stubGlobal(
      "Image",
      class extends MockImage {
        constructor() {
          super();
          this.width = 500;
          this.height = 400;
        }
      }
    );

    const mockBlob = new Blob(["test"], { type: "image/jpeg" });
    mockToBlob.mockImplementation((callback: (blob: Blob) => void) => {
      callback(mockBlob);
    });

    const { compressImage } = await import("@/lib/image");
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    await compressImage(file);

    // Should keep original dimensions (no upscaling)
    expect(mockCanvas.width).toBe(500);
    expect(mockCanvas.height).toBe(400);
  });

  it("returns the compressed blob", async () => {
    vi.stubGlobal(
      "Image",
      class extends MockImage {
        constructor() {
          super();
          this.width = 500;
          this.height = 500;
        }
      }
    );

    const mockBlob = new Blob(["compressed"], { type: "image/jpeg" });
    mockToBlob.mockImplementation((callback: (blob: Blob) => void) => {
      callback(mockBlob);
    });

    const { compressImage } = await import("@/lib/image");
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    const result = await compressImage(file);

    expect(result).toBe(mockBlob);
  });

  it("calls drawImage with correct parameters", async () => {
    vi.stubGlobal(
      "Image",
      class extends MockImage {
        constructor() {
          super();
          this.width = 500;
          this.height = 500;
        }
      }
    );

    const mockBlob = new Blob(["test"], { type: "image/jpeg" });
    mockToBlob.mockImplementation((callback: (blob: Blob) => void) => {
      callback(mockBlob);
    });

    const { compressImage } = await import("@/lib/image");
    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

    await compressImage(file);

    // drawImage should be called with the image at position 0,0 with canvas dimensions
    expect(mockDrawImage).toHaveBeenCalledWith(
      expect.any(Object), // The image object
      0,
      0,
      500,
      500
    );
  });

  it("converts HEIC file before canvas processing", async () => {
    vi.stubGlobal(
      "Image",
      class extends MockImage {
        constructor() {
          super();
          this.width = 500;
          this.height = 500;
        }
      }
    );

    const mockJpegBlob = new Blob(["converted jpeg"], { type: "image/jpeg" });
    mockedHeic2any.mockResolvedValue(mockJpegBlob);

    const mockCompressedBlob = new Blob(["compressed"], { type: "image/jpeg" });
    mockToBlob.mockImplementation((callback: (blob: Blob) => void) => {
      callback(mockCompressedBlob);
    });

    const { compressImage } = await import("@/lib/image");
    const heicFile = new File(["heic data"], "photo.heic", {
      type: "image/heic",
    });

    await compressImage(heicFile);

    // Should have called heic2any to convert before canvas processing
    expect(mockedHeic2any).toHaveBeenCalledWith({
      blob: heicFile,
      toType: "image/jpeg",
    });
  });

  it("does not call heic2any for JPEG files", async () => {
    vi.stubGlobal(
      "Image",
      class extends MockImage {
        constructor() {
          super();
          this.width = 500;
          this.height = 500;
        }
      }
    );

    const mockBlob = new Blob(["test"], { type: "image/jpeg" });
    mockToBlob.mockImplementation((callback: (blob: Blob) => void) => {
      callback(mockBlob);
    });

    const { compressImage } = await import("@/lib/image");
    const jpegFile = new File(["jpeg data"], "photo.jpg", {
      type: "image/jpeg",
    });

    await compressImage(jpegFile);

    // Should NOT have called heic2any
    expect(mockedHeic2any).not.toHaveBeenCalled();
  });

  it("propagates HEIC conversion errors", async () => {
    mockedHeic2any.mockRejectedValue(new Error("HEIC conversion failed"));

    const { compressImage } = await import("@/lib/image");
    const heicFile = new File(["heic data"], "photo.heic", {
      type: "image/heic",
    });

    await expect(compressImage(heicFile)).rejects.toThrow(
      "HEIC conversion failed"
    );
  });
});

describe("isHeicFile", () => {
  it("returns true for image/heic MIME type", async () => {
    const { isHeicFile } = await import("@/lib/image");
    const file = new File(["test"], "photo.heic", { type: "image/heic" });
    expect(isHeicFile(file)).toBe(true);
  });

  it("returns true for image/heif MIME type", async () => {
    const { isHeicFile } = await import("@/lib/image");
    const file = new File(["test"], "photo.heif", { type: "image/heif" });
    expect(isHeicFile(file)).toBe(true);
  });

  it("returns true for .heic extension when MIME is empty", async () => {
    const { isHeicFile } = await import("@/lib/image");
    const file = new File(["test"], "photo.heic", { type: "" });
    expect(isHeicFile(file)).toBe(true);
  });

  it("returns true for .heif extension when MIME is empty", async () => {
    const { isHeicFile } = await import("@/lib/image");
    const file = new File(["test"], "photo.heif", { type: "" });
    expect(isHeicFile(file)).toBe(true);
  });

  it("returns true for .HEIC extension (case insensitive)", async () => {
    const { isHeicFile } = await import("@/lib/image");
    const file = new File(["test"], "PHOTO.HEIC", { type: "" });
    expect(isHeicFile(file)).toBe(true);
  });

  it("returns false for JPEG files", async () => {
    const { isHeicFile } = await import("@/lib/image");
    const file = new File(["test"], "photo.jpg", { type: "image/jpeg" });
    expect(isHeicFile(file)).toBe(false);
  });

  it("returns false for PNG files", async () => {
    const { isHeicFile } = await import("@/lib/image");
    const file = new File(["test"], "photo.png", { type: "image/png" });
    expect(isHeicFile(file)).toBe(false);
  });

  it("returns false for file without extension and empty MIME", async () => {
    const { isHeicFile } = await import("@/lib/image");
    const file = new File(["test"], "photo", { type: "" });
    expect(isHeicFile(file)).toBe(false);
  });
});

describe("convertHeicToJpeg", () => {
  it("exports convertHeicToJpeg function and calls heic2any", async () => {
    // Note: True SSR safety verification requires integration testing in a Node.js
    // environment without window defined. This test verifies the function exists
    // and works correctly with the heic2any mock.
    const mockJpegBlob = new Blob(["converted"], { type: "image/jpeg" });
    mockedHeic2any.mockResolvedValue(mockJpegBlob);

    const { convertHeicToJpeg } = await import("@/lib/image");

    // Module should export convertHeicToJpeg
    expect(convertHeicToJpeg).toBeDefined();
    expect(typeof convertHeicToJpeg).toBe("function");

    // Calling it should work and use heic2any
    const file = new File(["heic data"], "photo.heic", { type: "image/heic" });
    const result = await convertHeicToJpeg(file);
    expect(result).toBe(mockJpegBlob);
  });

  it("returns Blob with image/jpeg type", async () => {
    const mockJpegBlob = new Blob(["converted"], { type: "image/jpeg" });
    mockedHeic2any.mockResolvedValue(mockJpegBlob);

    const { convertHeicToJpeg } = await import("@/lib/image");
    const file = new File(["heic data"], "photo.heic", { type: "image/heic" });

    const result = await convertHeicToJpeg(file);

    expect(result).toBe(mockJpegBlob);
    expect(result.type).toBe("image/jpeg");
    expect(mockedHeic2any).toHaveBeenCalledWith({
      blob: file,
      toType: "image/jpeg",
    });
  });

  it("handles array result from heic2any", async () => {
    // heic2any can return an array of blobs for multi-image HEIC files
    const mockJpegBlob = new Blob(["converted"], { type: "image/jpeg" });
    mockedHeic2any.mockResolvedValue([mockJpegBlob]);

    const { convertHeicToJpeg } = await import("@/lib/image");
    const file = new File(["heic data"], "photo.heic", { type: "image/heic" });

    const result = await convertHeicToJpeg(file);

    expect(result).toBe(mockJpegBlob);
  });

  it("throws on conversion failure", async () => {
    mockedHeic2any.mockRejectedValue(new Error("Conversion failed"));

    const { convertHeicToJpeg } = await import("@/lib/image");
    const file = new File(["heic data"], "photo.heic", { type: "image/heic" });

    await expect(convertHeicToJpeg(file)).rejects.toThrow("Conversion failed");
  });

  it("throws when heic2any returns empty array", async () => {
    mockedHeic2any.mockResolvedValue([]);

    const { convertHeicToJpeg } = await import("@/lib/image");
    const file = new File(["heic data"], "photo.heic", { type: "image/heic" });

    await expect(convertHeicToJpeg(file)).rejects.toThrow(
      "HEIC conversion returned no images"
    );
  });
});
