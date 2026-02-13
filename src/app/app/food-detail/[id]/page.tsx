import { getSession, validateSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { FoodDetail } from "@/components/food-detail";
import { SkipLink } from "@/components/skip-link";

export default async function FoodDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const validationError = validateSession(session);

  if (validationError) {
    redirect("/");
  }

  const { id } = await params;

  return (
    <div className="min-h-screen px-4 py-6">
      <SkipLink />
      <main id="main-content" className="mx-auto w-full max-w-md">
        <FoodDetail entryId={id} />
      </main>
    </div>
  );
}
