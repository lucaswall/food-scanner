import Link from "next/link";
import { redirect } from "next/navigation";
import { Camera, ListChecks, MessageCircle } from "lucide-react";
import { getSession } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard-shell";
import { DashboardPrefetch } from "@/components/dashboard-prefetch";
import { SkipLink } from "@/components/skip-link";
import { FitbitStatusBanner } from "@/components/fitbit-status-banner";
import { LumenBanner } from "@/components/lumen-banner";

export default async function AppPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <div className="min-h-screen px-4 py-6">
      <SkipLink />
      <main id="main-content" className="mx-auto w-full max-w-md flex flex-col gap-6">
        <h1 className="text-2xl font-bold">Food Scanner</h1>

        <FitbitStatusBanner />

        <div className="grid grid-cols-2 gap-4">
          <Link
            href="/app/analyze?autoCapture=true"
            className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 min-h-[44px] text-center shadow-sm hover:bg-accent transition-colors"
          >
            <Camera className="h-8 w-8 text-primary" />
            <span className="text-sm font-medium">Take Photo</span>
          </Link>
          <Link
            href="/app/quick-select"
            className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 min-h-[44px] text-center shadow-sm hover:bg-accent transition-colors"
          >
            <ListChecks className="h-8 w-8 text-primary" />
            <span className="text-sm font-medium">Quick Select</span>
          </Link>
        </div>

        <Link
          href="/app/chat"
          className="flex items-center justify-center gap-2 rounded-xl border bg-card p-3 min-h-[44px] text-center shadow-sm hover:bg-accent transition-colors"
        >
          <MessageCircle className="h-6 w-6 text-primary" />
          <span className="text-sm font-medium">Chat</span>
        </Link>

        <LumenBanner />

        <DashboardShell />
        <DashboardPrefetch />
      </main>
    </div>
  );
}
