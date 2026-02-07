import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { FoodHistory } from "@/components/food-history";
import { SkipLink } from "@/components/skip-link";

export default async function HistoryPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <div className="min-h-screen px-4 py-6">
      <SkipLink />
      <main id="main-content" className="mx-auto w-full max-w-md flex flex-col gap-6">
        <h1 className="text-2xl font-bold">History</h1>

        <FoodHistory />
      </main>
    </div>
  );
}
