import { BottomNav } from "@/components/bottom-nav";
import { AppRefreshGuard } from "@/components/app-refresh-guard";
import { SWRProvider } from "@/components/swr-provider";
import { PendingSubmissionHandler } from "@/components/pending-submission-handler";
import { SwipeNavigationWrapper } from "@/components/swipe-navigation-wrapper";
import { SentryUserContext } from "@/components/sentry-user-context";
import { getSession } from "@/lib/session";
import { getUserById } from "@/lib/users";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const user = session ? await getUserById(session.userId) : null;

  return (
    <AppRefreshGuard>
      {session && (
        <SentryUserContext userId={user?.id ?? session.userId} email={user?.email ?? ""} />
      )}
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
