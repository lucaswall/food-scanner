"use client";

import { Camera, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CaptureSessionBannerProps {
  captureCount: number;
  onProcess: () => void;
  onCapture: () => void;
}

export function CaptureSessionBanner({ captureCount, onProcess, onCapture }: CaptureSessionBannerProps) {
  if (captureCount === 0) return null;

  const label = captureCount === 1 ? "1 capture ready to process" : `${captureCount} captures ready to process`;

  return (
    <div className="w-full rounded-lg border border-primary/30 bg-primary/5 p-3 min-h-[44px] flex items-center gap-3">
      <Camera className="h-4 w-4 text-primary shrink-0" />
      <span className="flex-1 text-sm font-medium">{label}</span>
      <div className="flex gap-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCapture}
          className="min-h-[44px] min-w-[44px] h-auto px-3 text-xs"
        >
          Add More
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={onProcess}
          className="min-h-[44px] min-w-[44px] h-auto px-3 text-xs gap-1"
        >
          Process
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
