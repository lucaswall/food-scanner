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
      <div
        className={cn(
          "relative flex flex-[2] items-center justify-center rounded-md border min-h-[44px] transition-colors overflow-hidden select-none",
          value !== null
            ? "border-primary bg-primary/10 text-primary"
            : "border-input text-muted-foreground",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <span className="pointer-events-none text-sm font-medium" aria-hidden="true">
          {value !== null ? value : "Custom"}
        </span>
        <input
          type="time"
          disabled={disabled}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label={value !== null ? `Meal time: ${value}` : "Select custom time"}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            opacity: 0.01,
            fontSize: "16px",
            zIndex: 1,
            cursor: "pointer",
          }}
        />
      </div>
    </div>
  );
}
