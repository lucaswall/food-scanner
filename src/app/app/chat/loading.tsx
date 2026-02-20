import { Skeleton } from "@/components/ui/skeleton";

export default function ChatLoading() {
  return (
    <div className="flex flex-col h-[calc(100dvh-5rem)]">
      {/* Header skeleton */}
      <div className="border-b bg-background px-2 py-2">
        <div className="flex items-center gap-2">
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="h-6 w-16" />
        </div>
      </div>

      {/* Message area skeleton */}
      <div className="flex-1 px-3 py-2 space-y-2">
        {/* Initial assistant message */}
        <div className="flex justify-start">
          <Skeleton className="h-16 w-4/5 rounded-2xl rounded-bl-sm" />
        </div>
      </div>

      {/* Input area skeleton */}
      <div className="border-t bg-background">
        <div className="flex items-center gap-1.5 px-2 py-2">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="flex-1 h-10 rounded-full" />
          <Skeleton className="size-10 rounded-full" />
        </div>
      </div>
    </div>
  );
}
