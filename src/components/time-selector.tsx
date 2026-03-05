"use client";

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimeSelectorProps {
  value: string | null;
  onChange: (time: string | null) => void;
  disabled?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0")
);
const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0")
);

export function TimeSelector({ value, onChange, disabled }: TimeSelectorProps) {
  const hour = value?.split(":")[0] ?? "";
  const minute = value?.split(":")[1] ?? "";

  const handleHourChange = (h: string) => {
    const m = minute || "00";
    onChange(`${h}:${m}`);
  };

  const handleMinuteChange = (m: string) => {
    const h = hour || HOURS[new Date().getHours()];
    onChange(`${h}:${m}`);
  };

  const isCustom = value !== null;
  const selectClasses =
    "h-full bg-transparent text-sm font-medium text-center appearance-none border-0 outline-none p-0";

  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(null)}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors min-h-[44px]",
          !isCustom
            ? "border-primary bg-primary/10 text-primary"
            : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          disabled && "cursor-not-allowed opacity-50"
        )}
        aria-label="Meal time: Now"
        aria-pressed={!isCustom}
      >
        <Clock className="size-4" />
        Now
      </button>
      <div
        className={cn(
          "flex flex-1 items-center justify-center gap-0.5 rounded-md border px-3 py-2 min-h-[44px] transition-colors",
          isCustom
            ? "border-primary bg-primary/10 text-primary"
            : "border-input text-muted-foreground",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <select
          disabled={disabled}
          value={hour}
          onChange={(e) => handleHourChange(e.target.value)}
          aria-label="Hour"
          className={selectClasses}
          style={{ fontSize: "16px" }}
        >
          <option value="" disabled>
            HH
          </option>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="text-sm font-medium">:</span>
        <select
          disabled={disabled}
          value={minute}
          onChange={(e) => handleMinuteChange(e.target.value)}
          aria-label="Minute"
          className={selectClasses}
          style={{ fontSize: "16px" }}
        >
          <option value="" disabled>
            MM
          </option>
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
