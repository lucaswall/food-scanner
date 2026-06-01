import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { SkipLink } from "@/components/skip-link";
import { ArrowLeft } from "lucide-react";

export default async function ConnectHealthPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

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
          <h1 className="text-2xl font-bold">Connect Google Health</h1>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Connect your Google account</h2>
            <p className="text-sm text-muted-foreground">
              Connect Google Health to start logging food to your health data.
              You&apos;ll be redirected to Google to grant permission.
            </p>
          </div>

          <form action="/api/auth/google-health" method="POST">
            <Button type="submit" className="w-full min-h-[44px]">
              Connect Google Health
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
