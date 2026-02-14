import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto w-full max-w-md flex flex-col gap-6">
        <Skeleton data-testid="skeleton-heading" className="w-32 h-8" />

        {/* Tab bar skeleton */}
        <div data-testid="skeleton-tab-bar" className="flex gap-1 p-1 bg-muted rounded-full">
          <Skeleton className="h-9 flex-1 rounded-full" />
          <Skeleton className="h-9 flex-1 rounded-full" />
        </div>

        {/* Search input skeleton */}
        <Skeleton data-testid="skeleton-search-input" className="h-10 w-full rounded-md" />

        <div className="space-y-3">
          <Skeleton data-testid="skeleton-food-card" className="h-20 rounded-lg" />
          <Skeleton data-testid="skeleton-food-card" className="h-20 rounded-lg" />
          <Skeleton data-testid="skeleton-food-card" className="h-20 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
