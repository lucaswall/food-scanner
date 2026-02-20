import Link from "next/link";
import { Settings } from "lucide-react";

export function HeaderActions() {
  return (
    <div className="flex items-center gap-1">
      <Link
        href="/settings"
        aria-label="Settings"
        className="flex items-center justify-center rounded-full min-h-[44px] min-w-[44px] h-9 w-9 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Settings className="h-5 w-5" />
      </Link>
    </div>
  );
}
