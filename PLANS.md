# Implementation Plan

**Created:** 2026-02-06
**Source:** Inline request: Implement Smart Food Matching & Reuse (ROADMAP section 1) — keyword extraction, matching, nutrient tolerance, confirmation UI, reuse flow
**Linear Issues:** [FOO-160](https://linear.app/lw-claude/issue/FOO-160), [FOO-161](https://linear.app/lw-claude/issue/FOO-161), [FOO-162](https://linear.app/lw-claude/issue/FOO-162), [FOO-163](https://linear.app/lw-claude/issue/FOO-163), [FOO-164](https://linear.app/lw-claude/issue/FOO-164), [FOO-165](https://linear.app/lw-claude/issue/FOO-165), [FOO-166](https://linear.app/lw-claude/issue/FOO-166), [FOO-167](https://linear.app/lw-claude/issue/FOO-167)

## Context Gathered

### Codebase Analysis
- **Schema:** `custom_foods` table exists (`src/db/schema.ts:31-47`) — needs `keywords text[]` column added
- **Claude tool_use:** `src/lib/claude.ts:23-68` — `REPORT_NUTRITION_TOOL` schema has 11 fields, no `keywords` yet. `validateFoodAnalysis()` at line 82 returns `FoodAnalysis` type.
- **Types:** `FoodAnalysis` interface (`src/types/index.ts:47-59`) — needs `keywords` field. `FoodLogRequest` extends it. `FoodLogResponse` has `reusedFood: boolean` already.
- **DB insert:** `insertCustomFood()` in `src/lib/food-log.ts:29-56` — needs to accept and store keywords.
- **Fitbit client:** `findOrCreateFood()` in `src/lib/fitbit.ts:222-237` — always creates new food, hardcodes `reused: false`. Needs conditional path for reuse.
- **Log route:** `src/app/api/log-food/route.ts` — calls `findOrCreateFood()` then `insertCustomFood()`. Needs reuse path: skip `findOrCreateFood()`, use existing `fitbitFoodId`.
- **Frontend:** `FoodAnalyzer` in `src/components/food-analyzer.tsx` — after analysis, shows `AnalysisResult` + `MealTypeSelector` + "Log to Fitbit" button. Needs match section inserted between analysis and logging controls.
- **Test patterns:** Vitest, colocated `__tests__/` dirs, `vi.mock()` for module mocks, `mockResolvedValue`/`mockRejectedValue` for async.

### MCP Context
- **Linear:** FOO-158 (old reuse issue) already marked Duplicate. No backlog items to conflict.
- **Railway:** Not relevant for this feature.

## Original Plan

### Task 1: Add `keywords` column to `custom_foods` schema + update types
**Linear Issue:** [FOO-160](https://linear.app/lw-claude/issue/FOO-160/add-keywords-column-to-custom-foods-schema-update-foodanalysis-type)

1. Write test in `src/db/__tests__/schema.test.ts`:
   - Test `customFoods` table has a `keywords` column
   - Verify column exists in the table's column definitions
2. Run verifier (expect fail)
3. Update `src/db/schema.ts`:
   - Import `text` array type from drizzle-orm (use `.array()` on `text()`)
   - Add `keywords: text("keywords").array()` column to `customFoods` table (nullable — old rows won't have keywords)
4. Update `src/types/index.ts`:
   - Add `keywords: string[]` to `FoodAnalysis` interface
5. Run verifier (expect pass for schema test, expect type errors in claude.ts/log-food route — resolved in later tasks)

**Files:** `src/db/schema.ts`, `src/db/__tests__/schema.test.ts`, `src/types/index.ts`

---

### Task 2: Update Claude tool_use schema to emit keywords + update validation
**Linear Issue:** [FOO-161](https://linear.app/lw-claude/issue/FOO-161/update-claude-tool-use-schema-to-emit-keywords-update-validation)

1. Write test in `src/lib/__tests__/claude.test.ts`:
   - Test `validateFoodAnalysis` accepts input with `keywords` array of strings
   - Test `validateFoodAnalysis` rejects non-array `keywords`
   - Test `validateFoodAnalysis` rejects `keywords` containing non-string values
   - Test `validateFoodAnalysis` rejects empty `keywords` array
   - Test Claude response includes keywords in returned `FoodAnalysis`
2. Run verifier (expect fail)
3. Update `src/lib/claude.ts`:
   - Add `keywords` field to `REPORT_NUTRITION_TOOL.input_schema.properties`:
     ```
     keywords: {
       type: "array",
       items: { type: "string" },
       description: "Lowercase, normalized, language-agnostic tokens identifying this food. Include the food type, key distinguishing ingredients, and preparation method. Example: 'Tostadas con casancrem y huevos fritos' → ['tostada', 'casancrem', 'huevo', 'frito']"
     }
     ```
   - Add `"keywords"` to `required` array
   - Update `validateFoodAnalysis()` to validate `keywords`:
     - Must be an array
     - Must have at least 1 element
     - All elements must be strings
   - Return `keywords` in the validated output object
4. Run verifier (expect pass)

**Files:** `src/lib/claude.ts`, `src/lib/__tests__/claude.test.ts`

---

### Task 3: Update food-log insert to accept keywords + update log-food route
**Linear Issue:** [FOO-162](https://linear.app/lw-claude/issue/FOO-162/update-food-log-insert-to-accept-keywords-update-log-food-route)

1. Write tests in `src/lib/__tests__/food-log.test.ts`:
   - Test `insertCustomFood` stores `keywords` array in the `customFoods` table
   - Test `insertCustomFood` stores `null` keywords when not provided
2. Update tests in `src/app/api/log-food/__tests__/route.test.ts`:
   - Update mock request bodies to include `keywords` field
   - Test keywords are passed through to `insertCustomFood`
3. Run verifier (expect fail)
4. Update `src/lib/food-log.ts`:
   - Add `keywords?: string[] | null` to `CustomFoodInput` interface
   - Pass `keywords: data.keywords ?? null` in `insertCustomFood()`
5. Update `src/app/api/log-food/route.ts`:
   - Add `body.keywords` (from `FoodLogRequest` which extends `FoodAnalysis`) to `insertCustomFood` call (line 158-171):
     ```
     keywords: body.keywords,
     ```
6. Update `src/app/api/log-food/route.ts` validation function `isValidFoodLogRequest`:
   - Add validation: `keywords` must be an array of strings if present
7. Run verifier (expect pass)

**Files:** `src/lib/food-log.ts`, `src/lib/__tests__/food-log.test.ts`, `src/app/api/log-food/route.ts`, `src/app/api/log-food/__tests__/route.test.ts`

---

### Task 4: Create food matching service
**Linear Issue:** [FOO-163](https://linear.app/lw-claude/issue/FOO-163/create-food-matching-service-keyword-ratio-nutrient-tolerance)

1. Write tests in `src/lib/__tests__/food-matching.test.ts`:
   - **`computeMatchRatio` tests:**
     - `["tea", "milk"]` vs `["tea", "milk", "honey"]` → 1.0
     - `["tea"]` vs `["tea", "milk"]` → 1.0
     - `["pizza", "margherita"]` vs `["pizza", "pepperoni"]` → 0.5
     - `["pizza", "margherita"]` vs `["tea", "milk"]` → 0.0
     - Empty new keywords → 0 (edge case)
   - **`checkNutrientTolerance` tests:**
     - Matching nutrients within thresholds → true
     - Calories outside ±20%/±25kcal → false
     - Protein outside ±25%/±3g → false
     - Carbs outside ±25%/±5g → false
     - Fat outside ±25%/±3g → false
     - Low-value nutrients use absolute band (e.g., 10 cal ±25kcal passes for 30 cal)
     - High-value nutrients use percentage band (e.g., 800 cal ±20% passes for 700 cal)
     - All four must pass — one failure rejects
   - **`findMatchingFoods` tests:**
     - Returns empty array when no custom foods exist
     - Returns empty array when no keywords match at >= 0.5
     - Returns empty array when keywords match but nutrients differ
     - Returns matches ranked by match_ratio desc, then by most recently created
     - Returns max 3 matches
     - Ignores custom foods without keywords (null keywords)
2. Run verifier (expect fail)
3. Create `src/lib/food-matching.ts`:
   - Export `computeMatchRatio(newKeywords: string[], existingKeywords: string[]): number`
   - Export `checkNutrientTolerance(newFood: NutrientValues, existingFood: NutrientValues): boolean`
     - Interface `NutrientValues`: `{ calories: number; proteinG: number; carbsG: number; fatG: number }`
     - Thresholds: calories ±20%/±25, protein ±25%/±3, carbs ±25%/±5, fat ±25%/±3
     - Each check: `Math.abs(newVal - existVal) <= Math.max(existVal * pct, absolute)`
   - Export `findMatchingFoods(email: string, newAnalysis: FoodAnalysis): Promise<FoodMatch[]>`
     - Interface `FoodMatch`: `{ customFoodId: number; foodName: string; calories: number; proteinG: number; carbsG: number; fatG: number; fitbitFoodId: number; matchRatio: number; lastLoggedAt: Date; amount: number; unitId: number }`
     - Query all `custom_foods` for the user that have non-null keywords and non-null fitbitFoodId
     - Join with `food_log_entries` to get last logged date (MAX `logged_at` per `custom_food_id`)
     - Compute match_ratio for each, filter >= 0.5
     - Filter by nutrient tolerance
     - Sort by match_ratio desc, then lastLoggedAt desc
     - Return top 3
4. Run verifier (expect pass)

**Files:** `src/lib/food-matching.ts`, `src/lib/__tests__/food-matching.test.ts`

---

### Task 5: Create matching API endpoint
**Linear Issue:** [FOO-164](https://linear.app/lw-claude/issue/FOO-164/create-post-apifind-matches-endpoint)

1. Write tests in `src/app/api/find-matches/__tests__/route.test.ts`:
   - Test returns 401 for missing session
   - Test returns 400 for missing/invalid keywords
   - Test returns empty matches when no similar foods exist
   - Test returns up to 3 matches with correct shape
   - Test handles `findMatchingFoods` errors gracefully
2. Run verifier (expect fail)
3. Create `src/app/api/find-matches/route.ts`:
   - POST endpoint
   - Accepts JSON body: `FoodAnalysis` (with keywords)
   - Validates session (require auth, does NOT require Fitbit — matching is DB-only)
   - Calls `findMatchingFoods(email, analysis)`
   - Returns `{ matches: FoodMatch[] }`
4. Run verifier (expect pass)

**Files:** `src/app/api/find-matches/route.ts`, `src/app/api/find-matches/__tests__/route.test.ts`

---

### Task 6: Create FoodMatchCard component and integrate into FoodAnalyzer
**Linear Issue:** [FOO-165](https://linear.app/lw-claude/issue/FOO-165/create-foodmatchcard-component-and-integrate-into-foodanalyzer)

1. Write tests in `src/components/__tests__/food-match-card.test.tsx`:
   - Test renders food name, calories, macros, last logged date
   - Test renders amount with correct unit label
   - Test "Use this" button calls `onSelect` with the match data
   - Test "Use this" button has min 44px touch target
2. Write tests in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test calls `/api/find-matches` after analysis succeeds
   - Test shows match section when matches returned
   - Test hides match section when no matches
   - Test "Use this" triggers the reuse log flow (not the new-food flow)
   - Test "Log as new" still creates a new food entry
3. Run verifier (expect fail)
4. Create `src/components/food-match-card.tsx`:
   - Props: `match: FoodMatch`, `onSelect: (match: FoodMatch) => void`, `disabled?: boolean`
   - Shows food name, `getUnitLabel(unitId, amount)`, calories/protein/carbs/fat summary
   - Shows "Last logged: X" with relative date
   - "Use this" button (min-h-[44px])
5. Update `src/components/food-analyzer.tsx`:
   - Add state: `matches: FoodMatch[]`, `matchLoading: boolean`
   - After `setAnalysis(result.data)` succeeds in `handleAnalyze`, fire async call to `/api/find-matches`
   - Store results in `matches` state
   - Between `AnalysisResult` and post-analysis controls, conditionally render match section:
     - Heading: "Similar foods you've logged before"
     - Render up to 3 `FoodMatchCard` components
   - Add `handleUseExisting(match: FoodMatch)` — stores selected match, triggers reuse log flow
   - Rename current "Log to Fitbit" button to "Log as new" when matches exist
6. Run verifier (expect pass)

**Files:** `src/components/food-match-card.tsx`, `src/components/__tests__/food-match-card.test.tsx`, `src/components/food-analyzer.tsx`, `src/components/__tests__/food-analyzer.test.tsx`

---

### Task 7: Wire up reuse flow in log-food route + fitbit client
**Linear Issue:** [FOO-166](https://linear.app/lw-claude/issue/FOO-166/wire-up-reuse-flow-in-log-food-route-skip-fitbit-food-creation)

1. Write tests in `src/app/api/log-food/__tests__/route.test.ts`:
   - Test accepts `reuseCustomFoodId` field in request body
   - When `reuseCustomFoodId` is provided:
     - Test does NOT call `findOrCreateFood` (skips food creation)
     - Test calls `logFood` with the existing food's `fitbitFoodId`
     - Test inserts a `food_log_entry` referencing the existing `custom_food`
     - Test does NOT insert a new `custom_food`
     - Test response has `reusedFood: true`
   - When `reuseCustomFoodId` is NOT provided:
     - Test flow unchanged (creates new food, new custom_food row)
2. Write tests in `src/lib/__tests__/food-log.test.ts`:
   - Test `getCustomFoodById(id)` returns the food with correct fields
   - Test `getCustomFoodById(id)` returns null for non-existent ID
3. Run verifier (expect fail)
4. Update `src/lib/food-log.ts`:
   - Add `getCustomFoodById(id: number): Promise<CustomFood | null>` — queries `custom_foods` by ID, returns food data including `fitbitFoodId`
5. Update `src/types/index.ts`:
   - Add `reuseCustomFoodId?: number` to `FoodLogRequest` interface
6. Update `src/app/api/log-food/route.ts`:
   - At the start of the Fitbit section (line 136-153), check for `body.reuseCustomFoodId`:
     - If present: call `getCustomFoodById(body.reuseCustomFoodId)` to get existing food
     - If food not found or no `fitbitFoodId`: return error
     - Skip `findOrCreateFood()`, use existing `fitbitFoodId` directly
     - Call `logFood()` with existing food's amount/unitId/fitbitFoodId
     - Insert only a `food_log_entry` (not a new `custom_food`)
     - Set `reused = true`
   - If `reuseCustomFoodId` not present: existing flow unchanged
7. Update `src/components/food-analyzer.tsx`:
   - `handleUseExisting(match)` sends POST to `/api/log-food` with `reuseCustomFoodId: match.customFoodId` and current `mealTypeId`
8. Run verifier (expect pass)

**Files:** `src/lib/food-log.ts`, `src/lib/__tests__/food-log.test.ts`, `src/types/index.ts`, `src/app/api/log-food/route.ts`, `src/app/api/log-food/__tests__/route.test.ts`, `src/components/food-analyzer.tsx`

---

### Task 8: Generate Drizzle migration + update docs
**Linear Issue:** [FOO-167](https://linear.app/lw-claude/issue/FOO-167/generate-drizzle-migration-for-keywords-column-update-docs)

1. Run `npx drizzle-kit generate` to create migration for the `keywords` column addition
2. Verify generated SQL adds `keywords text[]` column to `custom_foods`
3. Update `CLAUDE.md`:
   - Add `/api/find-matches` to API endpoints table
   - Add `food-matching.ts` to lib section in STRUCTURE
   - Add `food-match-card.tsx` to components section
4. Run verifier (full suite: tests, lint, typecheck, build — all must pass with zero warnings)

**Files:** `drizzle/` (generated), `CLAUDE.md`

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Implement Smart Food Matching & Reuse to avoid duplicate Fitbit food definitions

**Request:** Plan ROADMAP section 1 (Smart Food Matching & Reuse) and remove it from the roadmap, renumbering remaining sections

**Linear Issues:** FOO-160, FOO-161, FOO-162, FOO-163, FOO-164, FOO-165, FOO-166, FOO-167

**Approach:** Four-layer implementation: (1) Schema + types for keywords, (2) Claude keyword extraction at analysis time, (3) Matching engine (keyword ratio + nutrient tolerance), (4) API + UI to present matches and wire up reuse flow that skips Fitbit food creation. New `/api/find-matches` endpoint decouples matching from logging. Reuse is opt-in via `reuseCustomFoodId` field in existing `/api/log-food` endpoint.

**Scope:**
- Tasks: 8
- Files affected: ~18 (8 source + 8 test + 2 generated/docs)
- New tests: yes (matching service, match API, match card component, reuse flow)

**Key Decisions:**
- Separate `/api/find-matches` endpoint rather than inlining matching into analyze-food — keeps matching decoupled and allows the frontend to call it asynchronously after analysis
- `reuseCustomFoodId` in existing `/api/log-food` rather than a new reuse endpoint — minimal API surface change
- Keywords are nullable on `custom_foods` — existing rows without keywords are excluded from matching (no backfill needed)
- Max 3 matches displayed, ranked by match_ratio desc then recency

**Risks/Considerations:**
- Keyword quality depends on Claude's consistency — the prompt guides on "type + ingredients + preparation" but can't guarantee identical keywords across sessions
- No backfill for existing custom_foods rows — matching only works for foods logged after this feature ships
- The match query fetches all user's custom_foods with keywords — acceptable at single-user scale (~3,650 rows/year max)
