"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ListChecks, ScanEye, Clock, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    label: "Home",
    href: "/app",
    icon: Home,
    isActive: (pathname: string) => pathname === "/app",
  },
  {
    label: "Quick Select",
    href: "/app/quick-select",
    icon: ListChecks,
    isActive: (pathname: string) => pathname === "/app/quick-select",
  },
  {
    label: "Analyze",
    href: "/app/analyze",
    icon: ScanEye,
    isActive: (pathname: string) => pathname === "/app/analyze",
  },
  {
    label: "History",
    href: "/app/history",
    icon: Clock,
    isActive: (pathname: string) => pathname === "/app/history",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    isActive: (pathname: string) => pathname === "/settings",
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="fixed bottom-0 left-0 right-0 bg-background border-t z-50 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div className="flex justify-around items-center max-w-md mx-auto">
        {navItems.map((item) => {
          const active = item.isActive(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center min-h-[44px] min-w-[44px] px-1 py-2 text-muted-foreground transition-colors",
                active && "text-primary"
              )}
              aria-current={active ? "page" : undefined}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-xs mt-0.5">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
