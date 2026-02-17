import type { FoodAnalysis } from '@/types';
import type { StreamEvent } from '@/lib/sse';

/**
 * Build a mock SSE response body from an array of StreamEvent objects.
 * Format: `data: <JSON>\n\n` for each event, matching `formatSSEEvent` in src/lib/sse.ts.
 */
export function buildSSEBody(events: StreamEvent[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

/**
 * Build an SSE body for a successful analyze-food response.
 * Emits: usage → analysis → done (minimal happy path).
 */
export function buildAnalyzeSSE(analysis: FoodAnalysis): string {
  return buildSSEBody([
    { type: 'usage', data: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 } },
    { type: 'analysis', analysis },
    { type: 'done' },
  ]);
}

/**
 * Build an SSE body for a successful chat-food response.
 * Emits: usage → text_delta (message) → optional analysis → done.
 */
export function buildChatSSE(message: string, analysis?: FoodAnalysis): string {
  const events: StreamEvent[] = [
    { type: 'usage', data: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 } },
    { type: 'text_delta', text: message },
  ];
  if (analysis) {
    events.push({ type: 'analysis', analysis });
  }
  events.push({ type: 'done' });
  return buildSSEBody(events);
}

/** Mock analysis result for E2E screenshot tests */
export const MOCK_ANALYSIS: FoodAnalysis = {
  food_name: 'Grilled Salmon with Vegetables',
  amount: 350,
  unit_id: 147, // grams
  calories: 420,
  protein_g: 38,
  carbs_g: 22,
  fat_g: 18,
  fiber_g: 5,
  sodium_mg: 380,
  saturated_fat_g: 3.2,
  trans_fat_g: 0,
  sugars_g: 4,
  calories_from_fat: 162,
  confidence: 'high',
  notes: 'Portion includes approximately 200g salmon fillet, 100g steamed broccoli and carrots, and 50g brown rice.',
  description: 'Grilled salmon fillet served with steamed vegetables and a side of brown rice',
  keywords: ['salmon', 'fish', 'grilled', 'vegetables', 'broccoli', 'rice'],
};

/** Mock refined analysis (after chat refinement) */
export const MOCK_REFINED_ANALYSIS: FoodAnalysis = {
  food_name: 'Grilled Salmon with Vegetables',
  amount: 300,
  unit_id: 147,
  calories: 380,
  protein_g: 35,
  carbs_g: 18,
  fat_g: 16,
  fiber_g: 4,
  sodium_mg: 350,
  saturated_fat_g: 2.8,
  trans_fat_g: 0,
  sugars_g: 3,
  calories_from_fat: 144,
  confidence: 'high',
  notes: 'Adjusted portion: 180g salmon fillet, 80g steamed vegetables, 40g brown rice. Reduced from original estimate.',
  description: 'Grilled salmon fillet served with steamed vegetables and a side of brown rice',
  keywords: ['salmon', 'fish', 'grilled', 'vegetables', 'broccoli', 'rice'],
};
