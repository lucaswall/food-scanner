import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ChatPageClient } from "@/components/chat-page-client";
import { HealthConnectGuard } from "@/components/health-connect-guard";
import { SkipLink } from "@/components/skip-link";

export default async function ChatPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <>
      <SkipLink />
      {/* The skip-link target lives here (not in ChatPageClient) so it exists even
          while HealthConnectGuard renders its connect prompt instead of the chat. */}
      <main id="main-content" className="contents">
        <HealthConnectGuard>
          <ChatPageClient />
        </HealthConnectGuard>
      </main>
    </>
  );
}
