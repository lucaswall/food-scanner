import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
});
