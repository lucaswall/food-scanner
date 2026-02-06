import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";

// Mock heic-to module with named export
vi.mock("heic-to", () => ({
  heicTo: vi.fn(),
}));

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
  private _src = "";
  onload: (() => void) | null = null;
  onerror: ((err: Error) => void) | null = null;

  get src() {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    // Simulate async image loading
    setTimeout(() => {
      this.onload?.();
    }, 0);
  }
}

beforeEach(() => {
  // Setup canvas mocks
  mockGetContext.mockReturnValue(mockContext);
  mockToBlob.mockImplementation((callback: (blob: Blob) => void) => {
    callback(new Blob(["image data"], { type: "image/jpeg" }));
  });

  // Setup global mocks
  global.document = {
    createElement: vi.fn((tag: string) => {
      if (tag === "canvas") return mockCanvas;
      return {};
    }),
  } as unknown as Document;

  global.Image = MockImage as unknown as typeof Image;

  // Setup FileReader mock
  interface FileReaderThis {
    onload?: (e: ProgressEvent) => void;
    result: string | null;
  }

  global.FileReader = class {
    readAsDataURL = vi.fn(function (this: FileReaderThis) {
      setTimeout(() => {
        this.onload?.({
          target: { result: "data:image/jpeg;base64,fake" },
        } as unknown as ProgressEvent);
      }, 0);
    });

    onload: ((e: ProgressEvent) => void) | null = null;
    onerror: ((e: ProgressEvent) => void) | null = null;
    result: string | null = null;
  } as unknown as typeof FileReader;
});

afterEach(() => {
  vi.clearAllMocks();
});

import { isHeicFile, compressImage, validateImage, convertHeicToJpeg } from "../image";

describe("Image utilities", () => {
  describe("isHeicFile", () => {
    it("detects HEIC by MIME type", () => {
      const file = new File([""], "test.heic", { type: "image/heic" });
      expect(isHeicFile(file)).toBe(true);
    });

    it("detects HEIF by MIME type", () => {
      const file = new File([""], "test.heif", { type: "image/heif" });
      expect(isHeicFile(file)).toBe(true);
    });

    it("detects HEIC by file extension (for Android)", () => {
      const file = new File([""], "photo.heic", { type: "" }); // Android issue: empty MIME
      expect(isHeicFile(file)).toBe(true);
    });

    it("detects HEIF by file extension (for Android)", () => {
      const file = new File([""], "photo.heif", { type: "" });
      expect(isHeicFile(file)).toBe(true);
    });

    it("returns false for non-HEIC files", () => {
      const file = new File([""], "test.jpg", { type: "image/jpeg" });
      expect(isHeicFile(file)).toBe(false);
    });

    it("returns false for files with no extension", () => {
      const file = new File([""], "test", { type: "image/jpeg" });
      expect(isHeicFile(file)).toBe(false);
    });

    it("handles case-insensitive MIME type check", () => {
      const file = new File([""], "test.jpg", { type: "IMAGE/HEIC" });
      expect(isHeicFile(file)).toBe(true);
    });

    it("handles case-insensitive extension check", () => {
      const file = new File([""], "photo.HEIC", { type: "" });
      expect(isHeicFile(file)).toBe(true);
    });
  });

  describe("validateImage", () => {
    it("accepts JPEG images", () => {
      const file = new File([""], "test.jpg", { type: "image/jpeg" });
      expect(validateImage(file).valid).toBe(true);
    });

    it("accepts PNG images", () => {
      const file = new File([""], "test.png", { type: "image/png" });
      expect(validateImage(file).valid).toBe(true);
    });

    it("accepts WebP images", () => {
      const file = new File([""], "test.webp", { type: "image/webp" });
      expect(validateImage(file).valid).toBe(true);
    });

    it("accepts GIF images", () => {
      const file = new File([""], "test.gif", { type: "image/gif" });
      expect(validateImage(file).valid).toBe(true);
    });

    it("accepts HEIC images", () => {
      const file = new File([""], "test.heic", { type: "image/heic" });
      expect(validateImage(file).valid).toBe(true);
    });

    it("accepts HEIF images", () => {
      const file = new File([""], "test.heif", { type: "image/heif" });
      expect(validateImage(file).valid).toBe(true);
    });

    it("rejects unsupported image types", () => {
      const file = new File([""], "test.bmp", { type: "image/bmp" });
      const result = validateImage(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unsupported");
    });

    it("rejects images larger than 10MB", () => {
      const largeData = new Uint8Array(11 * 1024 * 1024);
      const file = new File([largeData], "test.jpg", { type: "image/jpeg" });
      const result = validateImage(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too large");
    });

    it("accepts images exactly at 10MB limit", () => {
      const data = new Uint8Array(10 * 1024 * 1024);
      const file = new File([data], "test.jpg", { type: "image/jpeg" });
      expect(validateImage(file).valid).toBe(true);
    });

    it("handles case-insensitive MIME type check", () => {
      const file = new File([""], "test.jpg", { type: "IMAGE/JPEG" });
      expect(validateImage(file).valid).toBe(true);
    });

    it("accepts HEIC files with empty MIME type (Android fallback)", () => {
      // Android devices often report empty MIME for HEIC files
      const file = new File([""], "photo.heic", { type: "" });
      expect(validateImage(file).valid).toBe(true);
    });

    it("accepts HEIF files with empty MIME type (Android fallback)", () => {
      const file = new File([""], "photo.heif", { type: "" });
      expect(validateImage(file).valid).toBe(true);
    });

    it("rejects unknown files with empty MIME type", () => {
      const file = new File([""], "file.xyz", { type: "" });
      const result = validateImage(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("unknown");
    });
  });

  describe("compressImage", () => {
    it("compresses regular image files", async () => {
      const file = new File(["image data"], "test.jpg", { type: "image/jpeg" });
      const result = await compressImage(file);
      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe("image/jpeg");
    });

    it("handles HEIC files by converting then compressing", async () => {
      const { heicTo } = await import("heic-to");
      const mockedHeicTo = heicTo as Mock;
      mockedHeicTo.mockResolvedValue(new Blob(["converted jpeg"], { type: "image/jpeg" }));

      const file = new File(["heic data"], "photo.heic", { type: "image/heic" });
      const result = await compressImage(file);

      expect(mockedHeicTo).toHaveBeenCalledWith({
        blob: file,
        type: "image/jpeg",
        quality: 1,
      });
      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe("image/jpeg");
    });

    it("skips HEIC conversion for non-HEIC files", async () => {
      const { heicTo } = await import("heic-to");
      const mockedHeicTo = heicTo as Mock;

      const file = new File(["jpeg data"], "photo.jpg", { type: "image/jpeg" });
      await compressImage(file);

      expect(mockedHeicTo).not.toHaveBeenCalled();
    });
  });

  describe("convertHeicToJpeg", () => {
    it("returns single Blob directly (heic-to does not return arrays)", async () => {
      const { heicTo } = await import("heic-to");
      const mockedHeicTo = heicTo as Mock;
      const mockBlob = new Blob(["jpeg data"], { type: "image/jpeg" });
      mockedHeicTo.mockResolvedValue(mockBlob);

      const file = new File(["heic data"], "photo.heic", { type: "image/heic" });
      const result = await convertHeicToJpeg(file);

      expect(result).toBe(mockBlob);
      expect(mockedHeicTo).toHaveBeenCalledWith({
        blob: file,
        type: "image/jpeg",
        quality: 1,
      });
    });

    it("throws on conversion failure", async () => {
      const { heicTo } = await import("heic-to");
      const mockedHeicTo = heicTo as Mock;
      mockedHeicTo.mockRejectedValue(new Error("Conversion failed"));

      const file = new File(["heic data"], "photo.heic", { type: "image/heic" });

      await expect(convertHeicToJpeg(file)).rejects.toThrow("Conversion failed");
    });
  });
});
