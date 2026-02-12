import { BottomNav } from "@/components/bottom-nav";
import { AppRefreshGuard } from "@/components/app-refresh-guard";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppRefreshGuard>
      <div className="pb-20">{children}</div>
      <BottomNav />
    </AppRefreshGuard>
  );
}
