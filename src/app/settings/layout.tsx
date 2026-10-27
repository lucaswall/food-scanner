import { BottomNav } from "@/components/bottom-nav";
import { SWRProvider } from "@/components/swr-provider";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SWRProvider>
      <div className="pb-20">{children}</div>
      <BottomNav />
    </SWRProvider>
  );
}
