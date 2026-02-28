import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* Context header skeleton */}
      <div className="space-y-1">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Action row skeleton */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-11 w-32 rounded-full" />
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-24 rounded-full" />
      </div>

      {/* Chat area skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-3/4 rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>

      {/* Input skeleton */}
      <Skeleton className="h-11 w-full rounded-full" />
    </div>
  );
}
