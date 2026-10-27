import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { SkipLink } from "@/components/skip-link";
import { ArrowLeft } from "lucide-react";

const CONNECT_ERRORS: Record<string, string> = {
  account_in_use:
    "That Google Health account is already connected to another Food Scanner user. Choose a different Google account.",
  missing_scope:
    "Some Google Health permissions were not granted. Connect again and allow all requested permissions.",
};

interface ConnectHealthPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function ConnectHealthPage({ searchParams }: ConnectHealthPageProps) {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  const { error } = await searchParams;
  const errorMessage = error ? CONNECT_ERRORS[error] : undefined;

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

        {errorMessage && (
          <p role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </p>
        )}

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
