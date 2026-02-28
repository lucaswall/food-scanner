"use client";

import { useState } from "react";
import { formatTimeFromDate } from "@/lib/date-utils";

interface TimeSelectorProps {
  value: string | null;
  onChange: (time: string | null) => void;
  disabled?: boolean;
}

export function TimeSelector({ value, onChange, disabled }: TimeSelectorProps) {
  const [expanded, setExpanded] = useState(false);
  const showPicker = expanded || value !== null;

  const handleNowClick = () => {
    if (disabled) return;
    if (value !== null) {
      onChange(null);
      setExpanded(false);
    } else {
      setExpanded(!expanded);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleNowClick}
        disabled={disabled}
        aria-label="Now"
        className={`inline-flex items-center gap-1.5 px-3 rounded-full text-sm min-h-[44px] transition-colors ${
          value === null
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
      >
        Now
        {value === null && (
          <span className="text-xs opacity-75">{formatTimeFromDate(new Date())}</span>
        )}
      </button>
      {showPicker && (
        <input
          type="time"
          aria-label="Meal time"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          className="min-h-[44px] rounded-md border border-input bg-background px-2 text-sm"
        />
      )}
    </div>
  );
}
