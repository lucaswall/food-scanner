import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SettingsContent } from "@/components/settings-content";

export default async function SettingsPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return <SettingsContent />;
}
