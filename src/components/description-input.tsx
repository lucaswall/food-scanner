"use client";

import { useCallback } from "react";
import { Mic } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

const MAX_LENGTH = 500;
const PLACEHOLDER = "e.g., 250g pollo asado con chimichurri";

interface DescriptionInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function DescriptionInput({ value, onChange, disabled = false }: DescriptionInputProps) {
  const handleTranscript = useCallback(
    (transcript: string) => {
      const separator = value.length > 0 && !value.endsWith(" ") ? " " : "";
      onChange(value + separator + transcript);
    },
    [value, onChange]
  );

  const { isSupported, isListening, toggle } = useSpeechRecognition({
    lang: "es-AR",
    onResult: handleTranscript,
  });

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    onChange(newValue.slice(0, MAX_LENGTH));
  };

  return (
    <div className="space-y-1">
      <div className="relative">
        <textarea
          value={value}
          onChange={handleChange}
          placeholder={PLACEHOLDER}
          maxLength={MAX_LENGTH}
          rows={3}
          disabled={disabled}
          className="w-full px-3 py-2 pr-12 text-sm border rounded-md border-input bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {isSupported && (
          <button
            type="button"
            onClick={toggle}
            disabled={disabled}
            aria-label={isListening ? "Stop voice input" : "Start voice input"}
            className="absolute bottom-2 right-2 flex items-center justify-center w-11 h-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Mic
              className={`h-5 w-5 ${isListening ? "text-red-500 animate-pulse" : ""}`}
            />
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground text-right">
        {value.length}/{MAX_LENGTH}
      </p>
    </div>
  );
}
