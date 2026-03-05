"use client";

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimeSelectorProps {
  value: string | null;
  onChange: (time: string | null) => void;
  disabled?: boolean;
}

export function TimeSelector({ value, onChange, disabled }: TimeSelectorProps) {
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(null)}
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors min-h-[44px] flex-1",
          value === null
            ? "border-primary bg-primary/10 text-primary"
            : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          disabled && "cursor-not-allowed opacity-50"
        )}
        aria-label="Meal time: Now"
        aria-pressed={value === null}
      >
        <Clock className="size-4" />
        Now
      </button>
      <div className="relative flex-[2]">
        <input
          type="time"
          disabled={disabled}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label={value !== null ? `Meal time: ${value}` : "Select custom time"}
          className={cn(
            "w-full rounded-md border px-3 py-2 text-sm font-medium transition-colors min-h-[44px] appearance-none bg-transparent text-center",
            value !== null
              ? "border-primary bg-primary/10 text-primary"
              : "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            disabled && "cursor-not-allowed opacity-50"
          )}
          style={{ fontSize: "16px" }}
        />
        {value === null && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-muted-foreground">
            Custom
          </span>
        )}
      </div>
    </div>
  );
}
