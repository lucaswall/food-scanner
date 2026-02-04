import Link from "next/link";
import { getSession } from "@/lib/session";

export default async function AppPage() {
  const session = await getSession();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <main className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <h1 className="text-2xl font-bold">Food Scanner</h1>
        <p className="text-sm text-muted-foreground">{session.email}</p>

        <div className="w-full rounded-xl border bg-card p-6">
          <p className="text-muted-foreground">
            Camera interface coming soon
          </p>
        </div>

        <Link
          href="/settings"
          className="text-sm text-muted-foreground underline"
        >
          Settings
        </Link>
      </main>
    </div>
  );
}
