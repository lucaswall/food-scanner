import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="max-w-md mx-auto p-4 space-y-6">
      {/* Back button skeleton */}
      <Skeleton className="h-10 w-24" />

      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-6 w-20" />
        </div>
        <Skeleton className="h-5 w-64" />
      </div>

      {/* Description skeleton */}
      <Skeleton className="h-20 w-full rounded-lg" />

      {/* Nutrition card skeleton */}
      <div className="border rounded-lg p-4 space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>

      {/* Notes skeleton */}
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}
