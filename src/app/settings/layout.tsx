import { BottomNav } from "@/components/bottom-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="pb-20">{children}</div>
      <BottomNav />
    </>
  );
}
