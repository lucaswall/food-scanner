import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto w-full max-w-md flex flex-col gap-6">
        <Skeleton data-testid="skeleton-heading" className="w-32 h-8" />

        <div className="space-y-3">
          <Skeleton data-testid="skeleton-food-card" className="h-20 rounded-lg" />
          <Skeleton data-testid="skeleton-food-card" className="h-20 rounded-lg" />
          <Skeleton data-testid="skeleton-food-card" className="h-20 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
