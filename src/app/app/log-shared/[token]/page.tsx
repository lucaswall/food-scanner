import { LogSharedContent } from "./log-shared-content";
import { SkipLink } from "@/components/skip-link";

export default async function LogSharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="min-h-screen px-4 py-6">
      <SkipLink />
      <main id="main-content" className="mx-auto w-full max-w-md">
        <LogSharedContent token={token} />
      </main>
    </div>
  );
}
