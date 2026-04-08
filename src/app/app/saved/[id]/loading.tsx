import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto w-full max-w-md flex flex-col gap-4">
        {/* Header bar skeleton */}
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-7 w-48" />
        </div>

        {/* Nutrition card skeleton */}
        <Skeleton className="h-48 w-full rounded-xl" />

        {/* Meal type and time selector skeletons */}
        <Skeleton className="h-11 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />

        {/* Button row skeletons */}
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-md" />
          <Skeleton className="h-11 flex-1 rounded-md" />
        </div>

        {/* Bottom CTA skeleton */}
        <Skeleton className="h-14 w-full rounded-md" />
      </div>
    </div>
  );
}
