"use client";

import { useState } from "react";
import { PhotoCapture } from "./photo-capture";
import { DescriptionInput } from "./description-input";
import { AnalysisResult } from "./analysis-result";
import { compressImage } from "@/lib/image";
import { Button } from "@/components/ui/button";
import type { FoodAnalysis } from "@/types";

export function FoodAnalyzer() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [analysis, setAnalysis] = useState<FoodAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePhotosChange = (files: File[]) => {
    setPhotos(files);
    // Clear previous analysis when photos change
    if (files.length === 0) {
      setAnalysis(null);
      setError(null);
    }
  };

  const handleAnalyze = async () => {
    if (photos.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      // Compress all images
      const compressedBlobs = await Promise.all(photos.map(compressImage));

      // Create FormData
      const formData = new FormData();
      compressedBlobs.forEach((blob, index) => {
        formData.append("images", blob, `image-${index}.jpg`);
      });
      if (description) {
        formData.append("description", description);
      }

      // Send to API
      const response = await fetch("/api/analyze-food", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setError(result.error?.message || "Failed to analyze food");
        return;
      }

      setAnalysis(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    handleAnalyze();
  };

  return (
    <div className="space-y-6">
      <PhotoCapture onPhotosChange={handlePhotosChange} />

      <DescriptionInput value={description} onChange={setDescription} disabled={loading} />

      <Button
        onClick={handleAnalyze}
        disabled={photos.length === 0 || loading}
        className="w-full"
      >
        {loading ? "Analyzing..." : "Analyze Food"}
      </Button>

      <AnalysisResult
        analysis={analysis}
        loading={loading}
        error={error}
        onRetry={handleRetry}
      />
    </div>
  );
}
