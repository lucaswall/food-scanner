import { getSession, validateSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { EditFood } from "@/components/edit-food";
import { HealthConnectGuard } from "@/components/health-connect-guard";
import { SkipLink } from "@/components/skip-link";

export default async function EditFoodPage({
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
    <main id="main-content" className="contents">
      <div className="flex flex-col h-[calc(100dvh-5rem)]">
        <SkipLink />
        <HealthConnectGuard>
          <EditFood entryId={id} />
        </HealthConnectGuard>
      </div>
    </main>
  );
}
