"use client";

import { useRef } from "react";
import { ChevronDownIcon, Clock, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TimeSelectorProps {
  value: string | null;
  onChange: (time: string | null) => void;
  disabled?: boolean;
}

export function TimeSelector({ value, onChange, disabled }: TimeSelectorProps) {
  const timeInputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          className="border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]"
          aria-label={value !== null ? `Meal time: ${value}` : "Meal time: Now"}
        >
          <span className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            {value !== null ? value : "Now"}
          </span>
          <ChevronDownIcon className="size-4 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="z-[70]" align="start">
          <DropdownMenuItem
            className="min-h-[44px]"
            onSelect={() => onChange(null)}
          >
            {value === null && <Check className="size-4" />}
            <span className={value === null ? "" : "pl-6"}>Now</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-[44px]"
            onSelect={() => {
              setTimeout(() => timeInputRef.current?.showPicker(), 0);
            }}
          >
            {value !== null && <Check className="size-4" />}
            <span className={value !== null ? "" : "pl-6"}>
              {value !== null ? `Change time (${value})` : "Custom time"}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={timeInputRef}
        type="time"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </div>
  );
}
