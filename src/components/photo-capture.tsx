"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png"];

interface PhotoCaptureProps {
  onPhotosChange: (files: File[]) => void;
  maxPhotos?: number;
}

export function PhotoCapture({
  onPhotosChange,
  maxPhotos = 3,
}: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "Only JPEG and PNG images are allowed";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "Each image must be under 10MB";
    }
    return null;
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const newFiles = Array.from(fileList);

    // Validate each file
    for (const file of newFiles) {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        // Reset input
        if (inputRef.current) {
          inputRef.current.value = "";
        }
        return;
      }
    }

    // Clear any previous error
    setError(null);

    // Combine with existing photos, respecting the limit
    const combinedPhotos = [...photos, ...newFiles].slice(0, maxPhotos);

    // Create preview URLs for new photos
    const newPreviews = combinedPhotos.map((file) =>
      URL.createObjectURL(file)
    );

    // Revoke old preview URLs to prevent memory leaks
    previews.forEach((url) => URL.revokeObjectURL(url));

    setPhotos(combinedPhotos);
    setPreviews(newPreviews);
    onPhotosChange(combinedPhotos);

    // Reset input to allow selecting the same file again
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleClear = () => {
    // Revoke all preview URLs
    previews.forEach((url) => URL.revokeObjectURL(url));

    setPhotos([]);
    setPreviews([]);
    setError(null);
    onPhotosChange([]);

    // Reset input
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleFileChange}
          data-testid="photo-input"
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
        />
        <p className="text-xs text-gray-500">
          {photos.length}/{maxPhotos} photos selected
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}

      {previews.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {previews.map((preview, index) => (
              <div key={`preview-${index}`} className="relative aspect-square">
                <img
                  src={preview}
                  alt={`Preview ${index + 1}`}
                  className="w-full h-full object-cover rounded-md"
                />
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            className="w-full"
          >
            Clear All
          </Button>
        </div>
      )}
    </div>
  );
}
