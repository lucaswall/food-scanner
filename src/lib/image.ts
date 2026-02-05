const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.8;

export async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

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
