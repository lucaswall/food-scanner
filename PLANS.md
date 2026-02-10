# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-312-dashboard-fixes-and-improvements
**Issues:** FOO-312, FOO-310, FOO-311, FOO-309
**Created:** 2026-02-10
**Last Updated:** 2026-02-10

## Summary

Four improvements to the daily dashboard and food logging experience: fix a crash when Fitbit calorie goal is unset, improve AI description quality, update custom food metadata on reuse, and add an activity-based budget marker to the calorie ring.

## Issues

### FOO-312: Daily dashboard crashes when Fitbit calorie goal is not set

**Priority:** Medium
**Labels:** Bug
**Description:** When the user has no calorie goal in Fitbit, `getFoodGoals()` throws (`"Invalid Fitbit food goals response: missing goals.calories"`), returning a 500. This blocks the entire daily dashboard — food log, macros, and meals are all hidden behind the error.

**Acceptance Criteria:**
- [ ] Dashboard renders food data (meal breakdown, macros) even when no Fitbit calorie goal exists
- [ ] When no calorie goal: show calories as a plain number (no ring), similar to macro display
- [ ] When calorie goal exists: show calorie ring as today (no change)
- [ ] No error message shown — missing goal is a normal state, not an error

### FOO-310: AI food description includes irrelevant scene details and is too verbose

**Priority:** Medium
**Labels:** Improvement
**Description:** The Claude-generated `description` field describes the entire image scene (hands, cups, plates, background) instead of the food. The prompt at `src/lib/claude.ts:76-78` explicitly asks for "presentation" and "visual features" which encourages scene narration.

**Acceptance Criteria:**
- [ ] Description focuses exclusively on the food: ingredients, preparation method, portion size, distinguishing characteristics
- [ ] No references to hands, containers, plates, backgrounds, or other non-food elements
- [ ] Concise — 1-2 sentences max
- [ ] Clearly distinct from `notes` (description = what the food looks like; notes = what the model assumed)

### FOO-311: Update local custom food metadata when reusing a matched food

**Priority:** Medium
**Labels:** Improvement
**Description:** When reusing a matched custom food, the new analysis data is discarded. Local-only fields (`description`, `notes`, `keywords`, `confidence`) are never updated, even though the new analysis may have better data from clearer photos or improved prompts.

**Acceptance Criteria:**
- [ ] When reusing a matched food, update `description`, `notes`, `keywords`, and `confidence` on the existing custom food record with values from the new analysis
- [ ] Do NOT update `foodName`, nutritional values, `fitbitFoodId`, `amount`, or `unitId` — these stay in sync with Fitbit
- [ ] The reuse flow still uses the existing `fitbitFoodId` to log (no change to Fitbit behavior)
- [ ] When the reuse request doesn't include new analysis metadata (e.g., pending resubmission with `analysis: null`), skip the update

### FOO-309: Add activity-based budget marker to calorie ring

**Priority:** Medium
**Labels:** Feature
**Description:** The calorie ring shows consumed vs. goal but gives no sense of whether intake is on track given activity so far today. Add a budget marker — a visual tick on the ring perimeter showing how many calories the user can still eat based on current burn rate.

**Acceptance Criteria:**
- [ ] New `getActivitySummary()` function in Fitbit lib fetches calories burned today
- [ ] New `/api/activity-summary` route exposes activity data to the client
- [ ] Budget formula: `caloriesBurnedSoFar - deficit - caloriesConsumed`, where deficit = `estimatedTotalBurn - calorieGoal`
- [ ] Calorie ring shows a small marker/tick on the ring perimeter at the budget position
- [ ] Budget marker only appears when both calorie goal and activity data are available
- [ ] If budget is negative (over budget), marker still shows at 0 position or visual cue changes

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Fitbit API accessible (staging uses dry-run but API structure must be correct)

## Implementation Tasks

### Task 1: Make NutritionGoals.calories nullable

**Issue:** FOO-312
**Files:**
- `src/types/index.ts` (modify)
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)
- `src/app/api/nutrition-goals/route.ts` (modify)
- `src/app/api/nutrition-goals/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add test in `fitbit.test.ts` for `getFoodGoals()` when Fitbit returns a response without `goals.calories` (e.g., `goals: {}` or `goals.calories` is not a number). Assert it returns `{ calories: null }` instead of throwing.

2. **GREEN** — Change `NutritionGoals` interface: `calories: number | null`. In `getFoodGoals()`, instead of throwing when `typeof goals?.calories !== "number"`, return `{ calories: null }`. Update the `nutrition-goals/route.ts` logger to handle null calorie goal.

3. **REFACTOR** — Update existing tests in both `fitbit.test.ts` and `nutrition-goals/route.test.ts` that assert on the old throwing behavior or the old type.

**Notes:**
- This is the foundation for FOO-312 and FOO-309 — both need nullable calories
- The API route doesn't need structural changes, just the logger line that logs `calorieGoal`

### Task 2: Dashboard handles null calorie goal gracefully

**Issue:** FOO-312
**Files:**
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test: when `NutritionGoals` returns `{ calories: null }`, the dashboard renders food data (meal breakdown, macros) but shows a plain calorie number instead of the CalorieRing. Assert CalorieRing is NOT rendered, assert a text element shows the calorie total.

2. **GREEN** — In `DailyDashboard`, remove the `goalsError` fatal block (lines 75-83). Instead, treat goals as optional. When `goals?.calories` is non-null, render `CalorieRing`. When null, render a simple calorie display (the total as a large styled number, similar to how macros show values). Still fetch goals via SWR — just don't block the dashboard on errors or null values.

3. **REFACTOR** — The `goalsLoading` check can remain in the skeleton (it's a quick fetch). But `goalsError` should not block rendering — if goals fail entirely, treat as null goal.

**Notes:**
- Follow the pattern in `calorie-ring.tsx` center text for the fallback display: large number + "cal" label
- The dashboard currently passes `goals?.calories ?? 0` to CalorieRing — this fallback to 0 makes the ring show 0% which is misleading. With null, we skip the ring entirely.

### Task 3: Improve AI description prompt

**Issue:** FOO-310
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add/update test in `claude.test.ts` that asserts the tool schema's `description` field instruction contains key phrases: "food only" or "Do not describe" (scene exclusion), a length constraint like "1-2 sentences", and does NOT contain "presentation".

2. **GREEN** — Rewrite the `description` field prompt at `claude.ts:76-78`. New prompt should:
   - Focus on the food itself: ingredients visible, preparation/cooking method, portion size, distinguishing visual characteristics
   - Explicitly exclude non-food elements: hands, containers, plates, backgrounds, table settings
   - Add length constraint: "1-2 concise sentences"
   - Clarify purpose: "to distinguish this food from similar items"

3. **REFACTOR** — Verify the `notes` field prompt (line 69) remains clearly distinct from `description`.

**Notes:**
- Reference existing `notes` field prompt: "Any important assumptions or notes about the identification" — this is reasoning/caveats, while `description` is visual food characteristics
- No validation changes needed — `validateFoodAnalysis()` just checks `description` is a non-empty string

### Task 4: Send analysis metadata in reuse request

**Issue:** FOO-311
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **RED** — In `food-analyzer.test.tsx`, add test: when user selects "use existing" match, the `/api/log-food` POST body includes `newDescription`, `newNotes`, `newKeywords`, and `newConfidence` from the current analysis state alongside `reuseCustomFoodId`.

2. **GREEN** — In `food-analyzer.tsx` `handleUseExisting()` (line 276), add the current `analysis` metadata to the request body: `newDescription: analysis.description`, `newNotes: analysis.notes`, `newKeywords: analysis.keywords`, `newConfidence: analysis.confidence`. Only include these if `analysis` is non-null.

3. **REFACTOR** — Apply same pattern in `quick-select.tsx` for the resubmit flow. The pending submission already stores `analysis` — when resubmitting a reuse with a pending analysis, include the metadata fields. Note: the QuickSelect component's initial reuse (line 186-193) does NOT have analysis data (it's a shortcut from history), so no metadata is sent there — that's correct.

**Notes:**
- Use `new`-prefixed field names (`newDescription`, `newNotes`, etc.) to distinguish from the FoodAnalysis fields which represent the food's nutritional data
- The `FoodLogRequest` type won't enforce these fields since they're optional and only used in the reuse flow — the route handler will pick them from the raw body

### Task 5: Server-side custom food metadata update on reuse

**Issue:** FOO-311
**Files:**
- `src/lib/food-log.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/log-food/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add test in `food-log.test.ts` for a new `updateCustomFoodMetadata(userId, customFoodId, metadata)` function. Assert it updates `description`, `notes`, `keywords`, `confidence` on the matching custom food row and does NOT touch `foodName`, `calories`, `fitbitFoodId`, etc.

2. **GREEN** — Implement `updateCustomFoodMetadata()` in `food-log.ts`. It takes `userId`, `customFoodId`, and an object with optional `description`, `notes`, `keywords`, `confidence` fields. Uses Drizzle `update().set().where(and(eq(id), eq(userId)))`. Only sets fields that are present in the input.

3. **RED** — Add test in `log-food/route.test.ts`: when reuse request includes `newDescription`, `newNotes`, `newKeywords`, `newConfidence`, assert `updateCustomFoodMetadata` is called with those values after successful log insertion.

4. **GREEN** — In the reuse flow of `log-food/route.ts` (after line 213 where `insertFoodLogEntry` succeeds), extract `newDescription`, `newNotes`, `newKeywords`, `newConfidence` from the request body. If any are present, call `updateCustomFoodMetadata()`. This should be fire-and-forget with error logging (metadata update failure should NOT fail the log response).

5. **REFACTOR** — Add test: when reuse request does NOT include new metadata fields, `updateCustomFoodMetadata` is NOT called.

**Notes:**
- The metadata update is intentionally non-blocking — if it fails, the food is still logged successfully. Log the error but don't return an error response.
- Reference `insertCustomFood()` in `food-log.ts` for the Drizzle pattern (lines 37-70)

### Task 6: Add getActivitySummary to Fitbit lib

**Issue:** FOO-309
**Files:**
- `src/types/index.ts` (modify)
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add `ActivitySummary` interface to `src/types/index.ts`: `{ caloriesOut: number; estimatedCaloriesOut: number }`. Add test in `fitbit.test.ts` for `getActivitySummary(accessToken, date)` — mock the Fitbit API response for `GET /1/user/-/activities/date/{date}.json` and assert it returns an `ActivitySummary` with the correct fields extracted.

2. **GREEN** — Implement `getActivitySummary()` in `fitbit.ts`. Pattern: same as `getFoodGoals()` — use `fetchWithRetry`, parse JSON, validate `summary.caloriesOut` and `summary.estimatedCalories` (Fitbit field name for estimated total burn) are numbers.

3. **RED** — Add test for error cases: API failure returns appropriate error, invalid response shape throws `FITBIT_API_ERROR`.

4. **GREEN** — Implement error handling following the same pattern as `getFoodGoals()`.

**Notes:**
- Fitbit Activity Summary API: `GET /1/user/-/activities/date/YYYY-MM-DD.json` returns `{ summary: { caloriesOut: number, ... } }` and at the top level `{ goals: { caloriesOut: number, activeMinutes: number, ... } }`
- `estimatedCaloriesOut` may be named differently in the actual API response — the implementer should check the Fitbit API docs or test with a real response. If unavailable, use `caloriesOut` (actual burned so far) with a note that it's a lower bound.
- Only extract the fields we need for the budget calculation

### Task 7: Create /api/activity-summary route

**Issue:** FOO-309
**Files:**
- `src/app/api/activity-summary/route.ts` (create)
- `src/app/api/activity-summary/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** — Write route tests following the pattern in `nutrition-goals/__tests__/route.test.ts`: test auth enforcement (no session, no Fitbit), success case returning `ActivitySummary`, Fitbit error mapping, and `Cache-Control: private, no-cache` header.

2. **GREEN** — Implement the route handler. Same structure as `nutrition-goals/route.ts`: `getSession()` → `validateSession({ requireFitbit: true })` → `ensureFreshToken()` → `getActivitySummary()` → `successResponse()` with cache header. Same error mapping for `FITBIT_CREDENTIALS_MISSING`, `FITBIT_TOKEN_INVALID`, `FITBIT_API_ERROR`.

3. **REFACTOR** — Verify all error paths have test coverage.

**Notes:**
- Follow `nutrition-goals/route.ts` as the direct template — same auth, same error handling, same cache policy
- The route takes a `date` query parameter (same pattern as `nutrition-summary`)

### Task 8: Add budget marker to CalorieRing

**Issue:** FOO-309
**Files:**
- `src/components/calorie-ring.tsx` (modify)
- `src/components/__tests__/calorie-ring.test.tsx` (modify)
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests in `calorie-ring.test.tsx` for a new optional `budget` prop:
   - When `budget` is provided and positive, a marker element (line/tick) is rendered on the ring SVG at the corresponding position
   - When `budget` is not provided or undefined, no marker is rendered
   - When `budget` exceeds `goal`, marker is capped at the goal position (100%)
   - When `budget` is 0 or negative, marker is at the 0 position (start of ring)

2. **GREEN** — Add optional `budget?: number` prop to `CalorieRingProps`. Render a small SVG element (a short radial line or small circle) on the ring perimeter at the angle corresponding to `budget / goal`. The marker should be visually distinct from the progress arc — use a contrasting color or a different stroke style. Calculate the angle: `(budget / goal) * 360 degrees`, then position using `cos`/`sin` on the ring radius.

3. **RED** — Add test in `daily-dashboard.test.tsx`: when both goals and activity data are available, CalorieRing receives a `budget` prop calculated from the formula. When activity data is unavailable, CalorieRing does NOT receive a budget prop.

4. **GREEN** — In `DailyDashboard`, add a third SWR call for `/api/activity-summary?date=${today}`. Calculate budget: `activitySummary.caloriesOut - (activitySummary.estimatedCaloriesOut - goals.calories) - summary.totals.calories`. Pass as `budget` prop to CalorieRing. Only pass when all three data sources are available and `goals.calories` is non-null.

5. **REFACTOR** — Ensure the budget marker has a `data-testid` for test targeting. Verify the skeleton doesn't wait for activity data (activity fetch can be slower — dashboard should render without it and add the marker when data arrives).

**Notes:**
- The budget calculation represents "calories remaining in your budget right now": `burnedSoFar - plannedDeficit - consumed`. If the user is ahead of their deficit plan, this is positive (they can eat more). If behind, it's negative.
- SVG marker positioning: the ring starts at the top (12 o'clock, -90 degrees in SVG) and goes clockwise. Convert the budget fraction to an angle and use trigonometry to place the marker on the circle.
- The marker should be small and unobtrusive — a 3-4px line segment perpendicular to the ring, or a small dot on the ring path
- Activity data might load slower than nutrition data — the CalorieRing should render fine without the budget prop (marker just doesn't appear), then re-render when activity data arrives via SWR

### Task 9: Integration & Verification

**Issues:** FOO-312, FOO-310, FOO-311, FOO-309
**Files:** All files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Dashboard renders correctly with calorie goal set
   - [ ] Dashboard renders correctly without calorie goal (plain number, no ring)
   - [ ] AI descriptions are concise and food-focused
   - [ ] Reusing a matched food updates local metadata
   - [ ] Budget marker appears on calorie ring when activity data is available
   - [ ] Budget marker absent when activity data or goal is unavailable

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Fitbit has no calorie goal set | Dashboard shows plain calorie number, no ring | Unit test (Task 2) |
| Fitbit API returns no activity data | Dashboard renders without budget marker | Unit test (Task 8) |
| Activity summary API fails | Dashboard still renders ring without marker | Unit test (Task 8) |
| Metadata update fails during reuse | Food still logged successfully, error logged | Unit test (Task 5) |
| Reuse request has no new metadata | No metadata update attempted | Unit test (Task 5) |

## Risks & Open Questions

- [ ] **Fitbit activity API field names:** The exact field for "estimated total daily burn" may differ from what's documented. The implementer should verify against a real Fitbit API response or check docs. Fallback: use `caloriesOut` (burned so far) if estimated isn't available.
- [ ] **Budget marker visual design:** The exact visual treatment (line vs dot, color, size) will need iteration. Start with a simple approach and refine based on how it looks on mobile.

## Scope Boundaries

**In Scope:**
- Nullable calorie goal handling across the stack
- AI description prompt improvement
- Custom food metadata enrichment on reuse
- Activity-based budget marker on calorie ring

**Out of Scope:**
- Date navigation (viewing past days)
- Macro goals from Fitbit (only calorie goal is fetched)
- Custom goal setting within the app
- Activity summary display beyond the budget marker
