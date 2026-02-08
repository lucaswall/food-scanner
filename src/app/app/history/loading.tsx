import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto w-full max-w-md flex flex-col gap-6">
        <Skeleton data-testid="skeleton-heading" className="w-24 h-8" />

        <div data-testid="skeleton-date-picker" className="flex gap-2">
          <Skeleton className="flex-1 h-11" />
          <Skeleton className="w-16 h-11" />
        </div>

        <div className="space-y-3">
          <Skeleton data-testid="skeleton-entry" className="h-16 rounded-lg" />
          <Skeleton data-testid="skeleton-entry" className="h-16 rounded-lg" />
          <Skeleton data-testid="skeleton-entry" className="h-16 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
