"use client";

import { useState } from "react";
import { formatTimeFromDate } from "@/lib/date-utils";

interface TimeSelectorProps {
  value: string | null;
  onChange: (time: string | null) => void;
  disabled?: boolean;
}

export function TimeSelector({ value, onChange, disabled }: TimeSelectorProps) {
  const [showPicker, setShowPicker] = useState(value !== null);

  const handleNowClick = () => {
    setShowPicker(false);
    onChange(null);
  };

  const handlePickerClick = () => {
    setShowPicker(true);
    if (value === null) {
      // Pre-fill with current time when opening
      const now = new Date();
      onChange(formatTimeFromDate(now));
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value || null);
  };

  if (!showPicker) {
    return (
      <button
        type="button"
        onClick={handlePickerClick}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-sm min-h-[44px] text-muted-foreground hover:bg-muted/80"
        aria-label="Set time (currently Now)"
      >
        Now
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <input
        type="time"
        value={value ?? ""}
        onChange={handleTimeChange}
        disabled={disabled}
        aria-label="Time"
        className="px-2 py-1.5 rounded-md border text-sm min-h-[44px] bg-background"
      />
      <button
        type="button"
        onClick={handleNowClick}
        disabled={disabled}
        className="px-2.5 py-1 rounded-full bg-muted text-xs min-h-[44px] text-muted-foreground hover:bg-muted/80"
        aria-label="Reset to now"
      >
        Now
      </button>
    </div>
  );
}
