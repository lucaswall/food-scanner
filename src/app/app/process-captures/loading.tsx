import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto w-full max-w-md flex flex-col gap-4">
        {/* Header */}
        <Skeleton className="w-40 h-7" />

        {/* 3 item card skeletons */}
        <Skeleton className="w-full h-20 rounded-lg" />
        <Skeleton className="w-full h-20 rounded-lg" />
        <Skeleton className="w-full h-20 rounded-lg" />

        {/* Chat area skeleton */}
        <Skeleton className="w-full h-10 rounded-lg" />
      </div>
    </div>
  );
}
