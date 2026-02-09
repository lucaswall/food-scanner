import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkipLink } from "@/components/skip-link";
import { ArrowLeft } from "lucide-react";

export default function SetupFitbitLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <SkipLink />
      <main id="main-content" className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]">
            <Link href="/app" aria-label="Back to Food Scanner">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Set Up Fitbit</h1>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-[44px] w-full" />
            </div>

            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-[44px] w-full" />
            </div>

            <Skeleton className="h-[44px] w-full" />
          </div>
        </div>
      </main>
    </div>
  );
}
