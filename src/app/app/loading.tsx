import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto w-full max-w-md flex flex-col gap-6">
        <Skeleton data-testid="skeleton-heading" className="w-40 h-8" />

        <div className="grid grid-cols-2 gap-4">
          <Skeleton data-testid="skeleton-card" className="h-24 rounded-xl" />
          <Skeleton data-testid="skeleton-card" className="h-24 rounded-xl" />
        </div>

        <Skeleton data-testid="skeleton-preview" className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
