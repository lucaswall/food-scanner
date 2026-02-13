export const confidenceColors = {
  high: "bg-success",
  medium: "bg-warning",
  low: "bg-destructive",
} as const;

export const confidenceExplanations = {
  high: "High confidence: Claude is certain about this analysis based on clear visual information.",
  medium: "Medium confidence: The analysis is likely accurate but some details may need verification.",
  low: "Low confidence: Claude is uncertain. Please verify the nutritional values before logging.",
} as const;
