"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTitle,
} from "@/components/ui/dialog";
import { Dialog as DialogPrimitive } from "radix-ui";
import Image from "next/image";
import { X } from "lucide-react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

interface PhotoPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string | null;
  imageAlt?: string;
}

export function PhotoPreviewDialog({
  open,
  onOpenChange,
  imageUrl,
  imageAlt = "Full-size preview",
}: PhotoPreviewDialogProps) {
  if (!imageUrl) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] max-w-[95vw] max-h-[95vh] p-0 border-0 bg-transparent overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          aria-describedby={undefined}
        >
          <VisuallyHidden>
            <DialogTitle>Photo Preview</DialogTitle>
          </VisuallyHidden>
          <div className="relative flex items-center justify-center w-[95vw] h-[90vh]">
            <Image
              src={imageUrl}
              alt={imageAlt}
              fill
              unoptimized
              className="object-contain rounded-lg"
            />
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-2 right-2 min-h-[44px] min-w-[44px]"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
