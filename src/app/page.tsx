import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const session = await getSession();

  if (session) {
    redirect("/app");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <main className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-4xl font-bold tracking-tight">Food Scanner</h1>
          <p className="text-lg text-muted-foreground">
            AI-powered food logging for Fitbit
          </p>
        </div>

        <div className="flex w-full flex-col items-center gap-4 rounded-xl border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Take a photo of your meal, let AI analyze the nutrition, and log it
            directly to Fitbit.
          </p>
          <form action="/api/auth/google" method="POST" className="w-full">
            <Button type="submit" className="w-full" size="lg">
              Login with Google
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
