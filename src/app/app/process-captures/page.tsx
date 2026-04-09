import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { CaptureTriage } from "@/components/capture-triage";

export default async function ProcessCapturesPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <div className="min-h-screen px-4 py-6">
      <main className="mx-auto w-full max-w-md flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Process Captures</h1>
        <CaptureTriage />
      </main>
    </div>
  );
}
