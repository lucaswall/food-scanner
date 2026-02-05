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
 * Convert a HEIC/HEIF file to JPEG using heic2any library.
 * Throws on conversion failure.
 */
export async function convertHeicToJpeg(file: File): Promise<Blob> {
  // Dynamic import - only loads when function is called (client-side only)
  // This prevents "window is not defined" SSR errors since heic2any
  // accesses browser-only APIs during module initialization
  const heic2any = (await import("heic2any")).default;

  const result = await heic2any({
    blob: file,
    toType: "image/jpeg",
  });

  // heic2any can return array for multi-image HEIC files, take first
  if (Array.isArray(result)) {
    if (result.length === 0) {
      throw new Error("HEIC conversion returned no images");
    }
    return result[0];
  }

  return result;
}

export async function compressImage(file: File): Promise<Blob> {
  // Convert HEIC to JPEG first if needed
  let processFile: File | Blob = file;
  if (isHeicFile(file)) {
    processFile = await convertHeicToJpeg(file);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(processFile);

    img.onload = () => {
      // Clean up the object URL to prevent memory leak
      URL.revokeObjectURL(objectUrl);

      const { width, height } = img;

      // Calculate new dimensions
      let newWidth = width;
      let newHeight = height;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          // Landscape
          newWidth = MAX_DIMENSION;
          newHeight = Math.round((height / width) * MAX_DIMENSION);
        } else {
          // Portrait or square
          newHeight = MAX_DIMENSION;
          newWidth = Math.round((width / height) * MAX_DIMENSION);
        }
      }

      // Create canvas and draw resized image
      const canvas = document.createElement("canvas");
      canvas.width = newWidth;
      canvas.height = newHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      // Convert to JPEG blob at specified quality
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create blob"));
          }
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      // Clean up the object URL to prevent memory leak
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };

    // Load image from file
    img.src = objectUrl;
  });
}
