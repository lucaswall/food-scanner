import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { FreeChat } from "@/components/free-chat";

export default async function ChatPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return <FreeChat />;
}
