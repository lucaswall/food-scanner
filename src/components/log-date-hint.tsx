import { CalendarDays } from "lucide-react";
import { formatDisplayDate, isToday } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

interface LogDateHintProps {
  /** YYYY-MM-DD date the entry will be logged for; nothing renders when absent or today. */
  date: string | null | undefined;
  className?: string;
}

/**
 * Makes a non-today log date visible before saving (e.g. Claude picked up
 * "yesterday" from the description) so it is never applied silently.
 */
export function LogDateHint({ date, className }: LogDateHintProps) {
  if (!date || isToday(date)) return null;

  return (
    <p
      data-testid="log-date-hint"
      className={cn("flex items-center gap-1.5 text-sm font-medium text-primary", className)}
    >
      <CalendarDays className="size-4" aria-hidden="true" />
      Logging for {formatDisplayDate(date)}
    </p>
  );
}
