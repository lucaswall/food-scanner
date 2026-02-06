export const confidenceColors = {
  high: "bg-green-500",
  medium: "bg-yellow-500",
  low: "bg-red-500",
} as const;

export const confidenceExplanations = {
  high: "High confidence: Claude is certain about this analysis based on clear visual information.",
  medium: "Medium confidence: The analysis is likely accurate but some details may need verification.",
  low: "Low confidence: Claude is uncertain. Please verify the nutritional values before logging.",
} as const;
