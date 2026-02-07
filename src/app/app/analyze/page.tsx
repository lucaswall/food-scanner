import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { FoodAnalyzer } from "@/components/food-analyzer";
import { SkipLink } from "@/components/skip-link";

export default async function AnalyzePage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <div className="min-h-screen px-4 py-6">
      <SkipLink />
      <main id="main-content" className="mx-auto w-full max-w-md flex flex-col gap-6">
        <h1 className="text-2xl font-bold">Analyze Food</h1>

        <FoodAnalyzer />
      </main>
    </div>
  );
}
