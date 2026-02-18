import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SettingsContent } from "@/components/settings-content";
import { ApiKeyManager } from "@/components/api-key-manager";
import { ClaudeUsageSection } from "@/components/claude-usage-section";
import { AboutSection } from "@/components/about-section";
import { SkipLink } from "@/components/skip-link";

export default async function SettingsPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <>
      <SkipLink />
      <main id="main-content" className="max-w-2xl mx-auto px-4 py-6 pb-24 space-y-6">
        <SettingsContent />
        <ApiKeyManager />
        <ClaudeUsageSection />
        <AboutSection />
      </main>
    </>
  );
}
