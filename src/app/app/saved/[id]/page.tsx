import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SavedFoodDetail } from "@/components/saved-food-detail";
import { HealthConnectGuard } from "@/components/health-connect-guard";
import { SkipLink } from "@/components/skip-link";

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
      <SkipLink />
      <main id="main-content" className="mx-auto w-full max-w-md flex flex-col gap-6">
        <HealthConnectGuard>
          <SavedFoodDetail savedId={savedId} />
        </HealthConnectGuard>
      </main>
    </div>
  );
}
