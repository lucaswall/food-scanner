import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { FoodAnalyzer } from "@/components/food-analyzer";
import { SkipLink } from "@/components/skip-link";

interface AnalyzePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AnalyzePage({ searchParams }: AnalyzePageProps) {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  const params = await searchParams;
  const autoCapture = params.autoCapture === "true";

  return (
    <div className="min-h-screen px-4 py-6">
      <SkipLink />
      <main id="main-content" className="mx-auto w-full max-w-md flex flex-col gap-6">
        <h1 className="text-2xl font-bold">Analyze Food</h1>

        <FoodAnalyzer autoCapture={autoCapture} />
      </main>
    </div>
  );
}
