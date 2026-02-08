import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2">
          <Skeleton data-testid="skeleton-back-button" className="w-11 h-11" />
          <Skeleton data-testid="skeleton-heading" className="w-24 h-8" />
        </div>

        <Skeleton data-testid="skeleton-settings-card" className="h-48 rounded-xl" />
        <Skeleton data-testid="skeleton-appearance-card" className="h-32 rounded-xl" />
      </div>
    </div>
  );
}
