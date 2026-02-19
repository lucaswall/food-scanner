import Link from "next/link";
import { Camera, MessageCircle } from "lucide-react";

export function HeaderActions() {
  return (
    <div className="flex items-center gap-1">
      <Link
        href="/app/chat"
        aria-label="Chat"
        className="flex items-center justify-center rounded-full min-h-[44px] min-w-[44px] h-9 w-9 text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageCircle className="h-5 w-5" />
      </Link>
      <Link
        href="/app/analyze?autoCapture=true"
        aria-label="Take Photo"
        className="flex items-center justify-center rounded-full min-h-[44px] min-w-[44px] h-9 w-9 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Camera className="h-5 w-5" />
      </Link>
    </div>
  );
}
