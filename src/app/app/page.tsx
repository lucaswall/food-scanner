import Link from "next/link";
import { redirect } from "next/navigation";
import { Camera, ListChecks } from "lucide-react";
import { getSession } from "@/lib/session";
import { DashboardPreview } from "@/components/dashboard-preview";
import { DashboardPrefetch } from "@/components/dashboard-prefetch";
import { SkipLink } from "@/components/skip-link";

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

        <div className="grid grid-cols-2 gap-4">
          <Link
            href="/app/analyze"
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

        <DashboardPreview />
        <DashboardPrefetch />
      </main>
    </div>
  );
}
