import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { FitbitSetupForm } from "@/components/fitbit-setup-form";
import { Button } from "@/components/ui/button";
import { SkipLink } from "@/components/skip-link";
import { ArrowLeft } from "lucide-react";

export default async function SetupFitbitPage() {
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
          <h1 className="text-2xl font-bold">Set Up Fitbit</h1>
        </div>

        <FitbitSetupForm />
      </main>
    </div>
  );
}
