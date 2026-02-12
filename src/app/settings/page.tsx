import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SettingsContent } from "@/components/settings-content";
import { ApiKeyManager } from "@/components/api-key-manager";
import { ClaudeUsageSection } from "@/components/claude-usage-section";

export default async function SettingsPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <>
      <SettingsContent />
      <div className="container max-w-2xl mx-auto px-4 pb-24">
        <ApiKeyManager />
        <div className="mt-6">
          <ClaudeUsageSection />
        </div>
      </div>
    </>
  );
}
