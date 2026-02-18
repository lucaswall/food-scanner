import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ChatPageClient } from "@/components/chat-page-client";
import { SkipLink } from "@/components/skip-link";

export default async function ChatPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return (
    <>
      <SkipLink />
      <ChatPageClient />
    </>
  );
}
