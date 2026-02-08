"use client";

const MAX_LENGTH = 500;
const PLACEHOLDER = "e.g., 250g pollo asado con chimichurri";

interface DescriptionInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function DescriptionInput({ value, onChange, disabled = false }: DescriptionInputProps) {
  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    onChange(newValue.slice(0, MAX_LENGTH));
  };

  return (
    <div className="space-y-1">
      <textarea
        value={value}
        onChange={handleChange}
        placeholder={PLACEHOLDER}
        maxLength={MAX_LENGTH}
        rows={3}
        disabled={disabled}
        className="w-full px-3 py-2 text-sm border rounded-md border-input bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p className="text-xs text-muted-foreground text-right">
        {value.length}/{MAX_LENGTH}
      </p>
    </div>
  );
}
