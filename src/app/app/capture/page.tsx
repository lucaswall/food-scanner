import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { QuickCapture } from "@/components/quick-capture";
import { SkipLink } from "@/components/skip-link";

export default async function CapturePage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <div className="px-4 py-6">
      <SkipLink />
      <main id="main-content" className="mx-auto w-full max-w-md flex flex-col gap-6">
        <QuickCapture />
      </main>
    </div>
  );
}
