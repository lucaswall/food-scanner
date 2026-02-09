import { getSession, validateSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { FoodDetail } from "@/components/food-detail";

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

  return <FoodDetail entryId={id} />;
}
