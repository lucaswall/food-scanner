import { BottomNav } from "@/components/bottom-nav";
import { AppRefreshGuard } from "@/components/app-refresh-guard";
import { SWRProvider } from "@/components/swr-provider";
import { PendingSubmissionHandler } from "@/components/pending-submission-handler";
import { SwipeNavigationWrapper } from "@/components/swipe-navigation-wrapper";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppRefreshGuard>
      <SWRProvider>
        <PendingSubmissionHandler />
        <div className="pb-20">
          <SwipeNavigationWrapper>{children}</SwipeNavigationWrapper>
        </div>
        <BottomNav />
      </SWRProvider>
    </AppRefreshGuard>
  );
}
