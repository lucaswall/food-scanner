# Food Scanner - Roadmap

Future features and improvements to tackle after the current foundation is stable.

---

## Smart Food Matching & Reuse

When the user logs the same food repeatedly, we should avoid creating duplicate Fitbit food definitions and instead reuse existing ones when appropriate.

### Problem

Currently every food log creates a new Fitbit food definition (`POST /1/user/-/foods.json`), even if the user logs "Tea with milk" every morning. This clutters the Fitbit recent/frequent foods lists with duplicates and wastes API calls against the 150/hour rate limit.

### Matching Heuristic

A direct string comparison on food names is not enough because Claude generates slightly different names each time. The matching should work in two layers:

1. **Keyword extraction** — Extract meaningful keywords from the food name (e.g., "Tostadas con casancrem y huevos fritos" → `[tostada, casancrem, huevo, frito]`). Match against existing custom foods by keyword overlap rather than exact string equality. This handles variation in word order, pluralization, and minor phrasing differences.

2. **Nutrient tolerance** — When keyword matches are found, compare nutritional values with a tolerance band (e.g., calories within 15-20%, macros within reasonable range). A "tea with milk" at 11 cal should match another at 15 cal, but not one at 200 cal.

### User Confirmation

When a similar existing food is found:
- Present it to the user alongside the new Claude analysis
- User chooses: reuse the existing food, or create a new one
- No automatic silent reuse — the user always decides

### Editing vs. Re-prompting

The current nutrition editing UI (manual number fields) is not very useful — the user has no idea whether the AI's calorie estimate is right. Instead of editing numbers directly, support **re-prompting**: the user provides a clarification in natural language (e.g., "the glass is 0.5L not 300ml", "there are 3 eggs not 2", "it also has cheese on top") and Claude does a second pass to adjust the analysis. This is more natural and leverages the AI instead of asking the user to be a nutritionist.

### Implementation Order

1. Schema split: separate `custom_foods` table from `food_log_entries` (FOO-157)
2. Keyword extraction and matching logic
3. Nutrient tolerance comparison
4. UI for presenting matches and letting user choose
5. Re-prompting flow (clarification → second Claude pass)

### Dependencies

- FOO-157 (DB schema split) must land first to have a `custom_foods` table to query against
