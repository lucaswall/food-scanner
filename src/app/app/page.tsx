import Link from "next/link";
import { getSession } from "@/lib/session";
import { FoodAnalyzer } from "@/components/food-analyzer";
import { SkipLink } from "@/components/skip-link";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

export default async function AppPage() {
  const session = await getSession();

  return (
    <div className="min-h-screen px-4 py-6">
      <SkipLink />
      <main id="main-content" className="mx-auto w-full max-w-md flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Food Scanner</h1>
          <Button asChild variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]">
            <Link href="/settings" aria-label="Settings">
              <Settings className="h-5 w-5" />
            </Link>
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">{session.email}</p>

        <FoodAnalyzer />
      </main>
    </div>
  );
}
