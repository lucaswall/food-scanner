"use client";

import Link from "next/link";
import { Camera, ListChecks, MessageCircle } from "lucide-react";

export function FloatingActions() {
  return (
    <div className="fixed bottom-20 right-4 z-[55] flex flex-col items-end gap-3">
      <Link
        href="/app/chat"
        aria-label="Chat"
        className="flex items-center justify-center rounded-full bg-card text-foreground border shadow-md h-11 w-11 min-h-[44px] min-w-[44px]"
      >
        <MessageCircle className="h-5 w-5" />
      </Link>
      <Link
        href="/app/analyze?autoCapture=true"
        aria-label="Take Photo"
        className="flex items-center justify-center rounded-full bg-card text-foreground border shadow-md h-11 w-11 min-h-[44px] min-w-[44px]"
      >
        <Camera className="h-5 w-5" />
      </Link>
      <Link
        href="/app/quick-select"
        aria-label="Quick Select"
        className="flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg h-14 w-14 min-h-[44px] min-w-[44px]"
      >
        <ListChecks className="h-6 w-6" />
      </Link>
    </div>
  );
}
