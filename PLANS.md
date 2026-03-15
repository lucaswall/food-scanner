# Implementation Plan

**Created:** 2026-03-15
**Source:** Inline request: Replace static time-based meal type defaults with model-based suggestions using time, food context, and today's meal history
**Linear Issues:** [FOO-871](https://linear.app/lw-claude/issue/FOO-871/inject-current-time-and-todays-meals-into-claude-system-prompt), [FOO-872](https://linear.app/lw-claude/issue/FOO-872/update-claude-prompts-and-tool-schema-to-suggest-meal-type), [FOO-873](https://linear.app/lw-claude/issue/FOO-873/photo-flow-apply-claudes-meal-type-suggestion-to-ui-selector), [FOO-874](https://linear.app/lw-claude/issue/FOO-874/adjust-getdefaultmealtype-time-windows-dinner-1900-2159)
**Branch:** feat/FOO-871-model-based-meal-type

## Context Gathered

### Codebase Analysis
- **Related files:**
  - `src/lib/meal-type.ts` — `getDefaultMealType()` (static hour-based algorithm) and `getLocalDateTime()`
  - `src/lib/user-profile.ts` — `buildUserProfile()` builds system prompt context; already fetches `getDailyNutritionSummary` but discards per-meal breakdown
  - `src/lib/claude.ts` — System prompts (`SYSTEM_PROMPT`, `CHAT_SYSTEM_PROMPT`, `ANALYSIS_SYSTEM_PROMPT`), `REPORT_NUTRITION_TOOL` schema (meal_type_id description says "never guess"), `analyzeFood()`, `conversationalRefine()`, `getSystemPrompt()`, `getAnalysisSystemPrompt()`, `getChatSystemPrompt()`
  - `src/lib/chat-tools.ts` — `SEARCH_FOOD_LOG_TOOL`, `executeSearchFoodLog()`
  - `src/lib/food-log.ts` — `getDailyNutritionSummary()` returns `NutritionSummary` with `meals: MealGroup[]` including `mealTypeId`, `entries[].time`, `entries[].foodName`
  - `src/app/api/analyze-food/route.ts` — Receives `clientDate` from FormData, passes to `analyzeFood()`; no `clientTime` param
  - `src/app/api/chat-food/route.ts` — Receives `clientDate` in JSON body, passes to `conversationalRefine()`; no `clientTime` param
  - `src/components/food-analyzer.tsx` — Photo flow; SSE analysis event calls `actions.setAnalysis()` but does NOT update `mealTypeId` from `analysis.mealTypeId`
  - `src/components/food-chat.tsx` — Chat flow; DOES update `mealTypeId` from `analysis.mealTypeId` (line 430-431)
  - `src/hooks/use-analysis-session.ts` — DEFAULT_STATE uses `getDefaultMealType()` at module level (line 59)
  - `src/components/meal-type-selector.tsx` — Dropdown with time hint text
  - `src/types/index.ts` — `FoodAnalysis` interface, `FitbitMealType` enum, `FITBIT_MEAL_TYPE_LABELS`, `NutritionSummary`, `MealGroup`, `MealEntry`
  - `src/lib/date-utils.ts` — `getTodayDate()`, `formatTimeFromDate()`
- **Existing patterns:**
  - `clientDate` flows: frontend `getTodayDate()` → API route validates format → passes to Claude functions as `currentDate`
  - `buildUserProfile` returns a string under 1200 chars, injected into system prompt via `getSystemPrompt()`
  - `getSystemPrompt()` prepends user profile to base `SYSTEM_PROMPT`; `getAnalysisSystemPrompt()` and `getChatSystemPrompt()` extend with role-specific instructions
  - Both `analyzeFood()` and `conversationalRefine()` append `\nToday's date is: ${currentDate}` to the system prompt
  - Chat flow respects Claude's `meal_type_id` (updates UI); photo flow ignores it
- **Test conventions:**
  - `src/lib/__tests__/meal-type.test.ts` — Tests `getDefaultMealType()` with `vi.spyOn(Date.prototype, "getHours")`
  - `src/lib/__tests__/user-profile.test.ts` — Tests `buildUserProfile()` with mocked dependencies; checks profile string content
  - `src/components/__tests__/food-analyzer.test.tsx` — Component tests for photo flow
  - `src/components/__tests__/food-chat.test.tsx` — Component tests for chat flow

### MCP Context
- **MCPs used:** Linear (issue creation)
- **Findings:** Created FOO-871, FOO-872, FOO-873 in Todo state.

## Tasks

### Task 1: Inject current time and today's meals into Claude system prompt
**Linear Issue:** [FOO-871](https://linear.app/lw-claude/issue/FOO-871/inject-current-time-and-todays-meals-into-claude-system-prompt)
**Files:**
- `src/lib/__tests__/user-profile.test.ts` (modify)
- `src/lib/user-profile.ts` (modify)
- `src/app/api/analyze-food/route.ts` (modify)
- `src/app/api/chat-food/route.ts` (modify)
- `src/lib/claude.ts` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/food-chat.tsx` (modify)

**Steps:**
1. Write tests in `src/lib/__tests__/user-profile.test.ts` for the new `currentTime` parameter and today's meals section:
   - Test that when `currentTime` is provided, profile includes `"Current time: HH:MM"` line
   - Test that when `currentTime` is omitted/undefined, no current time line appears (backward compatibility)
   - Test that when `nutritionSummary.meals` has entries, profile includes a "Today's meals" section listing each meal with: meal type label, time (if present), food name. Example: `"Today's meals: Breakfast at 08:30 — Café con leche (90 cal), Lunch at 13:00 — Milanesa (650 cal)"`
   - Test that when meals have no time, format is just meal type + food name (no "at HH:MM")
   - Test that when no meals logged today, the "Today's meals" section is omitted
   - Test that the 1200-char truncation drops today's meals before top foods (today's meals is higher priority than top foods for meal type inference, but both are lower than goals/progress — actually, reconsider: today's meals should be higher priority than top foods since it's directly relevant to meal type. Drop top foods first, then today's meals if still over limit)
   - Test that `buildUserProfile` still works with only `(userId, currentDate)` args (no breaking change)
2. Run verifier with pattern `"user-profile"` (expect fail)
3. Implement changes:
   - **`src/lib/user-profile.ts`:** Add optional `currentTime?: string` parameter to `buildUserProfile()`. Add new section between progress and top foods: build "Today's meals" from `nutritionSummary.meals` — for each `MealGroup`, list entries with `FITBIT_MEAL_TYPE_LABELS[mealTypeId]`, entry time (formatted HH:MM if present), food name, and calories. Add "Current time: {currentTime}" as a separate line after goals/progress when provided. Adjust truncation: drop top foods first, then today's meals if still over 1200 chars.
   - **`src/app/api/analyze-food/route.ts`:** Extract `clientTime` from FormData (same validation pattern as `clientDate` — validate HH:MM format with regex `^\d{2}:\d{2}$`). Pass to `analyzeFood()`.
   - **`src/app/api/chat-food/route.ts`:** Extract `clientTime` from JSON body with same HH:MM validation. Pass to `conversationalRefine()`.
   - **`src/lib/claude.ts`:** Update `analyzeFood()` and `conversationalRefine()` signatures to accept optional `currentTime?: string`. Pass it through to `getAnalysisSystemPrompt()` / `getChatSystemPrompt()` → `getSystemPrompt()` → `buildUserProfile()`. Append `"Current time: ${currentTime}"` alongside the existing `"Today's date is: ${currentDate}"` line when available.
   - **`src/components/food-analyzer.tsx`:** Add `getLocalDateTime().time` to FormData as `clientTime` alongside existing `clientDate`.
   - **`src/components/food-chat.tsx`:** Add `clientTime: getLocalDateTime().time` to the request body alongside existing `clientDate`.
4. Run verifier with pattern `"user-profile"` (expect pass)

**Notes:**
- `buildUserProfile` signature changes from `(userId, currentDate, log?)` to `(userId, currentDate, options?)` where options is `{ currentTime?: string; log?: Logger }` — cleaner than adding more positional params. Update all call sites.
- The profile priority order becomes: Goals > Progress > Current time > Today's meals > Top foods. Truncation removes from bottom up.
- Import `FITBIT_MEAL_TYPE_LABELS` from `@/types` in `user-profile.ts` for meal type label formatting.

### Task 2: Update Claude prompts and tool schema to suggest meal type
**Linear Issue:** [FOO-872](https://linear.app/lw-claude/issue/FOO-872/update-claude-prompts-and-tool-schema-to-suggest-meal-type)
**Files:**
- `src/lib/claude.ts` (modify)

**Steps:**
1. No unit tests needed — this task changes prompt text and tool schema descriptions (natural language), not testable logic. Behavior is verified by integration in Task 3 tests and manual validation.
2. Modify `src/lib/claude.ts`:
   - **`CHAT_SYSTEM_PROMPT` line 74:** Replace the "Never ask which meal type" instruction. New instruction: "Always suggest a meal_type_id based on: (1) the current time, (2) what meals have already been logged today (from the user profile), and (3) the type of food being analyzed (snack-like foods → Morning Snack or Afternoon Snack, full meals → Lunch or Dinner). Exception: when editing an existing entry (editing_entry_id is set), always preserve the original meal_type_id from the search_food_log results unless the user explicitly asks to change it."
   - **`ANALYSIS_SYSTEM_PROMPT`:** Add the same meal type suggestion instruction (currently has no explicit meal type guidance — the constraint was only in CHAT_SYSTEM_PROMPT and the tool schema).
   - **`REPORT_NUTRITION_TOOL` schema (line 166-169):** Update `meal_type_id` description from "Only set when the user mentions the meal context... never guess the meal type" to: "Fitbit meal type: 1=Breakfast, 2=Morning Snack, 3=Lunch, 4=Afternoon Snack, 5=Dinner, 7=Anytime. Always suggest based on current time, today's logged meals, and food type. When editing an existing entry, preserve the original value unless user asks to change it."
3. Run verifier (full — no pattern; prompt changes could affect snapshot tests or type checks)

**Notes:**
- The key behavioral shift: Claude goes from "leave null unless user says 'for breakfast'" to "always suggest based on context, user can override in UI."
- The "time" field instruction (line 75) stays unchanged — time should still only be set when the user explicitly mentions it.

### Task 3: Photo flow — apply Claude's meal type suggestion to UI selector
**Linear Issue:** [FOO-873](https://linear.app/lw-claude/issue/FOO-873/photo-flow-apply-claudes-meal-type-suggestion-to-ui-selector)
**Files:**
- `src/components/__tests__/food-analyzer.test.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/hooks/use-analysis-session.ts` (modify)
- `src/hooks/__tests__/use-analysis-session.test.ts` (modify)
- `src/lib/__tests__/meal-type.test.ts` (modify)
- `src/lib/meal-type.ts` (modify)

**Steps:**
1. Write/update tests:
   - **`src/components/__tests__/food-analyzer.test.tsx`:** Add test that when an analysis SSE event arrives with `mealTypeId: 5`, the MealTypeSelector updates to show Dinner. Add test that when analysis arrives with `mealTypeId: null`, the meal type selector retains `getDefaultMealType()` value.
   - **`src/hooks/__tests__/use-analysis-session.test.ts`:** Update the `DEFAULT_STATE` expectation — `mealTypeId` initial value changes from a specific number to whatever `getDefaultMealType()` returns (this test currently expects `7` which is hardcoded for the test's mocked time).
   - **`src/lib/__tests__/meal-type.test.ts`:** Keep existing `getDefaultMealType` tests (they still serve as fallback validation). The function itself is retained as a fallback.
2. Run verifier with pattern `"food-analyzer|use-analysis-session|meal-type"` (expect fail for new analyzer tests)
3. Implement changes:
   - **`src/components/food-analyzer.tsx`:** In the `event.type === "analysis"` handler (around line 285), after `actions.setAnalysis(event.analysis)`, add: if `event.analysis.mealTypeId != null`, call `actions.setMealTypeId(event.analysis.mealTypeId)`. This mirrors the existing pattern in `food-chat.tsx` lines 430-431.
   - **`src/hooks/use-analysis-session.ts`:** No change to DEFAULT_STATE — keep `getDefaultMealType()` as initial value. Claude's suggestion overrides it when the analysis arrives. This is fine because the meal type selector shows while Claude is processing, and the default is a reasonable placeholder until Claude responds.
   - **`src/lib/meal-type.ts`:** Keep `getDefaultMealType()` unchanged — it serves as the initial UI default before Claude responds, and as a fallback when Claude returns `meal_type_id: null`.
4. Run verifier with pattern `"food-analyzer|use-analysis-session|meal-type"` (expect pass)

**Notes:**
- The MealTypeSelector hint text `"Based on current time (HH:MM)"` remains accurate as the initial default, but once Claude responds, the selector value changes. The hint text becomes slightly misleading. Consider changing the hint to just show the time without "Based on" — but this is cosmetic and can be a follow-up.
- `getDefaultMealType()` is NOT deleted — it remains as:
  1. Initial placeholder in UI while Claude is processing
  2. Fallback when Claude returns `meal_type_id: null` (shouldn't happen with new prompt, but defensive)
  3. Used by `food-chat.tsx` initial state (line 127) — same pattern applies there

### Task 4: Adjust getDefaultMealType time windows
**Linear Issue:** [FOO-874](https://linear.app/lw-claude/issue/FOO-874/adjust-getdefaultmealtype-time-windows-dinner-1900-2159)
**Files:**
- `src/lib/__tests__/meal-type.test.ts` (modify)
- `src/lib/meal-type.ts` (modify)

**Steps:**
1. Update tests in `src/lib/__tests__/meal-type.test.ts`:
   - Change "returns 5 (Dinner) at 17:00" → test at hour 19 instead
   - Add test: hour 17 returns 4 (Afternoon Snack)
   - Add test: hour 18 returns 4 (Afternoon Snack)
   - Change "returns 7 (Anytime) at 3:00" → keep as-is (3:00 is still Anytime)
   - Add test: hour 22 returns 7 (Anytime)
   - Add test: hour 21 returns 5 (Dinner) — boundary check
2. Run verifier with pattern `"meal-type"` (expect fail)
3. Update `src/lib/meal-type.ts` `getDefaultMealType()`:
   - Afternoon Snack: `hour >= 14 && hour < 19` (was `< 17`)
   - Dinner: `hour >= 19 && hour < 22` (was `>= 17 && < 21`)
   - Anytime: fallthrough at `hour >= 22` or `hour < 5` (was `>= 21`)
4. Run verifier with pattern `"meal-type"` (expect pass)

**Notes:**
- This task has no dependencies on Tasks 1–3 and can be implemented in parallel.
- Affects Quick Select (which doesn't go through Claude) and serves as the initial UI placeholder/fallback in photo and chat flows.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Replace static time-based meal type defaults with intelligent model-based suggestions, giving Claude time-of-day context and today's meal history to infer the correct meal type. Also fix the static fallback time windows.
**Linear Issues:** FOO-871, FOO-872, FOO-873, FOO-874
**Approach:** Four changes: (1) Inject current time and today's per-meal breakdown into the system prompt via `buildUserProfile`, adding `clientTime` to both API routes. (2) Reverse Claude's "never guess meal type" instruction to "always suggest based on time, food type, and today's meals." (3) Make the photo flow respect Claude's meal type suggestion, matching the existing chat flow behavior. (4) Adjust `getDefaultMealType()` time windows — dinner shifts to 19:00–21:59, afternoon snack expands to 14:00–18:59. This fixes Quick Select (which doesn't use Claude) and the initial UI placeholder.
**Scope:** 4 tasks, ~12 files, ~12 new tests
**Key Decisions:** Keep `getDefaultMealType()` as fallback rather than deleting it — it provides a reasonable placeholder while Claude processes. Claude's suggestion overrides it when the analysis completes.
**Risks:** Claude may occasionally suggest wrong meal types, but the user can always override via the dropdown — same as today, except the default will be better in the vast majority of cases.
