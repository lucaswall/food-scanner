"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TimeSelectorProps {
  value: string | null;
  onChange: (time: string | null) => void;
  disabled?: boolean;
}

export function TimeSelector({ value, onChange, disabled }: TimeSelectorProps) {
  const [showTimeInput, setShowTimeInput] = useState(false);

  useEffect(() => {
    if (value === null) setShowTimeInput(false);
  }, [value]);

  const selectValue = value !== null || showTimeInput ? "select-time" : "now";

  const handleValueChange = (val: string) => {
    if (val === "now") {
      onChange(null);
      setShowTimeInput(false);
    } else {
      setShowTimeInput(true);
    }
  };

  return (
    <div className="space-y-2">
      <Select
        value={selectValue}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger
          className="w-full min-h-[44px]"
          aria-label={value !== null ? `Meal time: ${value}` : "Meal time: Now"}
        >
          <SelectValue>
            {value !== null ? value : "Now"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="z-[70]">
          <SelectItem value="now" className="min-h-[44px]">
            Now
          </SelectItem>
          <SelectItem value="select-time" className="min-h-[44px]">
            Select time
          </SelectItem>
        </SelectContent>
      </Select>
      {(showTimeInput || value !== null) && (
        <input
          type="time"
          aria-label="Meal time"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          className="w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
        />
      )}
    </div>
  );
}
