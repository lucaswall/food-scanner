import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto w-full max-w-md flex flex-col gap-6">
        <Skeleton data-testid="skeleton-heading" className="w-36 h-8" />
        <Skeleton data-testid="skeleton-photo" className="h-48 rounded-xl" />
        <Skeleton data-testid="skeleton-input" className="h-10" />
        <Skeleton data-testid="skeleton-button" className="h-11 w-full" />
      </div>
    </div>
  );
}
