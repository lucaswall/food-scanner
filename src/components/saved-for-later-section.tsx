"use client";

import type { SavedAnalysisListItem } from "@/types";

interface SavedForLaterSectionProps {
  items: SavedAnalysisListItem[];
  onItemClick: (id: number) => void;
}

function getRelativeTime(createdAt: string): string {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const diffMs = now - created;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

export function SavedForLaterSection({ items, onItemClick }: SavedForLaterSectionProps) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Saved for Later</span>
        <span
          data-testid="saved-count-badge"
          className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          {items.length}
        </span>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            data-testid="saved-item-card"
            onClick={() => onItemClick(item.id)}
            className="w-full flex items-center justify-between gap-3 rounded-lg border p-3 min-h-[44px] text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{truncate(item.description, 30)}</p>
              <p className="text-xs text-muted-foreground">{item.calories} cal</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {getRelativeTime(item.createdAt)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
