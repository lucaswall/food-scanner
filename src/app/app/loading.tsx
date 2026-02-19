import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto w-full max-w-md flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Skeleton data-testid="skeleton-heading" className="w-40 h-8" />
          <div data-testid="skeleton-actions" className="flex items-center gap-1">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </div>

        <Skeleton data-testid="skeleton-toggle" className="h-11 rounded-full" />

        <Skeleton data-testid="skeleton-preview" className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
