const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.8;

const HEIC_MIME_TYPES = ["image/heic", "image/heif"];
const HEIC_EXTENSIONS = [".heic", ".heif"];

/**
 * Detect if a file is a HEIC/HEIF image.
 * Checks both MIME type and file extension (Android sometimes reports empty MIME for HEIC).
 */
export function isHeicFile(file: File): boolean {
  // Check MIME type first
  if (HEIC_MIME_TYPES.includes(file.type.toLowerCase())) {
    return true;
  }

  // Fallback to extension check (for Android devices that report empty MIME)
  const dotIndex = file.name.lastIndexOf(".");
  const extension = dotIndex !== -1 ? file.name.toLowerCase().slice(dotIndex) : "";
  return HEIC_EXTENSIONS.includes(extension);
}

/**
 * Convert a HEIC/HEIF file to JPEG using heic-to library.
 * Uses quality: 1 for maximum fidelity to preserve image details.
 * Throws on conversion failure.
 */
export async function convertHeicToJpeg(file: File): Promise<Blob> {
  // Dynamic import - only loads when function is called (client-side only)
  // This prevents "window is not defined" SSR errors since heic-to
  // accesses browser-only APIs during module initialization
  const { heicTo } = await import("heic-to");

  // heic-to returns a single Blob (unlike heic2any which returned arrays)
  const result = await heicTo({
    blob: file,
    type: "image/jpeg",
    quality: 1, // Maximum quality to preserve image fidelity
  });

  return result;
}

export async function compressImage(file: File): Promise<Blob> {
  // Convert HEIC to JPEG first if needed
  let processFile: File | Blob = file;
  if (isHeicFile(file)) {
    processFile = await convertHeicToJpeg(file);
  }

  // If it's a blob (from HEIC conversion), convert to File for canvas operations
  const fileToCompress = processFile instanceof File ? processFile : new File([processFile], "image.jpg", { type: "image/jpeg" });

  const canvas = await createResizedCanvas(fileToCompress);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to compress image: canvas.toBlob returned null"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

async function createResizedCanvas(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(MAX_DIMENSION / img.width, MAX_DIMENSION / img.height, 1);

        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas 2D context"));
          return;
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error("Failed to load image for resizing"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Validate image file before processing.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateImage(file: File): { valid: boolean; error?: string } {
  const validMimes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"];

  // Check MIME type first, then fallback to extension for HEIC (Android reports empty MIME)
  const isValidMime = validMimes.includes(file.type.toLowerCase());
  const isHeicByExtension = isHeicFile(file);

  if (!isValidMime && !isHeicByExtension) {
    return { valid: false, error: `Unsupported image type: ${file.type || "unknown"}` };
  }

  const maxSizeMb = 10;
  if (file.size > maxSizeMb * 1024 * 1024) {
    return { valid: false, error: `Image too large. Max ${maxSizeMb}MB.` };
  }

  return { valid: true };
}
