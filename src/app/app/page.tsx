import Link from "next/link";
import { getSession } from "@/lib/session";
import { FoodAnalyzer } from "@/components/food-analyzer";

export default async function AppPage() {
  const session = await getSession();

  return (
    <div className="min-h-screen px-4 py-6">
      <main className="mx-auto w-full max-w-md flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Food Scanner</h1>
          <Link
            href="/settings"
            className="text-sm text-muted-foreground underline"
          >
            Settings
          </Link>
        </div>

        <p className="text-sm text-muted-foreground">{session.email}</p>

        <FoodAnalyzer />
      </main>
    </div>
  );
}
