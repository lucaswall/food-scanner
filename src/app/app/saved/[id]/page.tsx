import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SavedFoodDetail } from "@/components/saved-food-detail";
import { FitbitSetupGuard } from "@/components/fitbit-setup-guard";

interface SavedFoodPageProps {
  params: Promise<{ id: string }>;
}

export default async function SavedFoodPage({ params }: SavedFoodPageProps) {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  const { id } = await params;
  const savedId = parseInt(id, 10);

  if (isNaN(savedId)) {
    redirect("/app");
  }

  return (
    <div className="min-h-screen px-4 py-6">
      <main className="mx-auto w-full max-w-md flex flex-col gap-6">
        <FitbitSetupGuard>
          <SavedFoodDetail savedId={savedId} />
        </FitbitSetupGuard>
      </main>
    </div>
  );
}
