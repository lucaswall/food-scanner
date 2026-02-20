import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard-shell";
import { DashboardPrefetch } from "@/components/dashboard-prefetch";
import { SkipLink } from "@/components/skip-link";
import { FitbitStatusBanner } from "@/components/fitbit-status-banner";
export default async function AppPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <div className="min-h-screen px-4 py-6">
      <SkipLink />
      <main id="main-content" className="mx-auto w-full max-w-md flex flex-col gap-6">
        <FitbitStatusBanner />

        <DashboardShell />

        <DashboardPrefetch />
      </main>
    </div>
  );
}
