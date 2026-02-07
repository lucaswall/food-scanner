# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-168-batch-features
**Issues:** FOO-168, FOO-169, FOO-170, FOO-171, FOO-173
**Created:** 2026-02-06
**Last Updated:** 2026-02-06

## Summary

Implement five features spanning UX improvements (nutrition card on success, auto-reconnect Fitbit), new screens (quick select home, food history), and navigation infrastructure (bottom nav bar). Issues are ordered by dependency: FOO-169 and FOO-168 are standalone UI changes, FOO-170 requires a new route and API endpoint, FOO-171 adds history with deletion, and FOO-173 ties everything together with shared navigation.

## Issues

### FOO-168: Auto-reconnect Fitbit and retry when token expires during food logging

**Priority:** Urgent
**Labels:** Bug
**Description:** When `log-food` returns `FITBIT_TOKEN_INVALID`, persist pending submission to `sessionStorage`, auto-redirect to Fitbit OAuth, and resubmit on return.

**Acceptance Criteria:**
- [ ] When `log-food` returns `FITBIT_TOKEN_INVALID`, pending submission (analysis + mealTypeId) is persisted to `sessionStorage`
- [ ] Fitbit OAuth is initiated automatically (no manual navigation to Settings)
- [ ] After reconnect, user is redirected back to `/app`
- [ ] On `/app` load, pending submission in `sessionStorage` is auto-resubmitted
- [ ] Success screen shown on resubmission; error shown and data cleared on failure
- [ ] Photos are NOT preserved (analysis is already complete)
- [ ] Only handles `FITBIT_TOKEN_INVALID` — other errors show error messages as today

### FOO-169: Show nutrition facts card on success screen

**Priority:** High
**Labels:** Improvement
**Description:** After logging food, show a nutrition facts card on the success screen displaying calories, macros, amount, unit, and meal type.

**Acceptance Criteria:**
- [ ] Success screen displays nutrition facts card (food name, amount with unit, calories, protein, carbs, fat, fiber, sodium)
- [ ] Card also shows the meal type that was selected
- [ ] `FoodLogConfirmation` receives analysis data and mealTypeId as new props
- [ ] Existing elements (checkmark, success message, "Log Another" button) remain
- [ ] Card is mobile-friendly

### FOO-170: Quick select home screen with time-based common food suggestions

**Priority:** High
**Labels:** Feature
**Description:** New home screen at `/app` showing frequently logged foods ranked by time-of-day proximity. Photo analysis moves to `/app/analyze`.

**Acceptance Criteria:**
- [ ] `/app` is quick select home screen; photo analysis moves to `/app/analyze`
- [ ] Query last 30 days of food log entries joined to custom foods (where `fitbitFoodId IS NOT NULL`)
- [ ] Rank by ascending absolute time difference between current time and entry's `time` column
- [ ] Deduplicate by `customFoodId` (keep smallest time diff); show up to 5 results
- [ ] Each card shows: food name, amount, unit, calories, macros
- [ ] Tapping a food shows confirmation with nutrition details and "Log to Fitbit" button
- [ ] Logging reuses existing `fitbitFoodId` — no new custom food created
- [ ] Meal type auto-selected based on current time
- [ ] After logging, success screen shown; "Log Another" returns to `/app`
- [ ] Empty state: "No recent foods" with prominent "Take Photo" button
- [ ] Buttons at top and bottom to navigate to `/app/analyze`

### FOO-171: Food log history screen with daily summaries and entry deletion

**Priority:** Medium
**Labels:** Feature
**Description:** New page at `/app/history` showing food log entries grouped by date with daily calorie/macro summaries. Supports entry deletion (Fitbit + local DB) and a date picker to jump to specific dates.

**Acceptance Criteria:**
- [ ] New page at `/app/history` showing entries grouped by date
- [ ] Entries within each day listed chronologically by time
- [ ] Each entry shows: food name, calories, protein/carbs/fat, amount with unit, meal type, time
- [ ] Daily summary row per date: total calories, protein, carbs, fat
- [ ] Infinite scroll loading older days (start from today, go backward)
- [ ] Date picker to jump to a specific date
- [ ] Delete button on each entry (removes from Fitbit and local DB)
- [ ] New API endpoint for fetching history (date range + pagination)
- [ ] New API endpoint for deleting a food log entry
- [ ] New DB query functions in `src/lib/food-log.ts`
- [ ] New Fitbit delete function in `src/lib/fitbit.ts`
- [ ] Temporary nav link from `/app` to `/app/history` (until FOO-173)

### FOO-173: Add bottom navigation bar across app routes

**Priority:** Medium
**Labels:** Feature
**Description:** Bottom tab navigation bar visible on all protected routes: Home (`/app`), History (`/app/history`), Settings (`/settings`).

**Acceptance Criteria:**
- [ ] Bottom nav visible on `/app`, `/app/history`, `/settings`
- [ ] Nav items: Home, History, Settings with icons
- [ ] Active route visually highlighted
- [ ] Touch targets at least 44x44px
- [ ] Works in standalone PWA mode
- [ ] Remove temporary nav link from FOO-171

## Prerequisites

- [ ] Main branch is clean and up-to-date
- [ ] Local Postgres running (`docker compose up -d`)
- [ ] No active PLANS.md (this overwrites the completed one)

## Implementation Tasks

---

### Task 1: Add nutrition facts card to success screen (FOO-169)

**Issue:** FOO-169
**Files:**
- `src/components/food-log-confirmation.tsx` (modify)
- `src/components/__tests__/food-log-confirmation.test.tsx` (create)
- `src/components/food-analyzer.tsx` (modify)
- `src/types/index.ts` (modify — add `FITBIT_MEAL_TYPE_LABELS` map)

**TDD Steps:**

1. **RED** — Write test for `FoodLogConfirmation` rendering nutrition data:
   - Create `src/components/__tests__/food-log-confirmation.test.tsx`
   - Test: renders food name, calories, protein, carbs, fat, fiber, sodium, amount+unit, meal type label
   - Test: renders "Log Another" button
   - Test: renders existing elements (checkmark, success message)
   - Test: handles missing `analysis` prop gracefully (backward compat during transition)
   - Mock `vibrateSuccess` from `@/lib/haptics`
   - Run: `npm test -- food-log-confirmation`
   - Verify: Tests fail (component doesn't accept new props yet)

2. **GREEN** — Update `FoodLogConfirmation`:
   - Add `FITBIT_MEAL_TYPE_LABELS` map to `src/types/index.ts`:
     ```typescript
     export const FITBIT_MEAL_TYPE_LABELS: Record<number, string> = {
       1: "Breakfast", 2: "Morning Snack", 3: "Lunch",
       4: "Afternoon Snack", 5: "Dinner", 7: "Anytime",
     };
     ```
   - Add props: `analysis?: FoodAnalysis`, `mealTypeId?: number`
   - Render a nutrition facts card below the checkmark/success message using Tailwind:
     - Bordered card with bold "Nutrition Facts" header
     - Food name and amount+unit (use `getUnitLabel()` from `@/types`)
     - Thick separator
     - Calories (bold, large)
     - Horizontal rule
     - Rows for: Protein, Carbs, Fat, Fiber, Sodium (each with value + unit)
     - Meal type label at bottom
   - Keep existing elements (checkmark, success text, Log Another button) unchanged
   - Run: `npm test -- food-log-confirmation`
   - Verify: Tests pass

3. **GREEN** — Update `FoodAnalyzer` to pass new props:
   - In `src/components/food-analyzer.tsx` line 291, add props to `<FoodLogConfirmation>`:
     ```tsx
     <FoodLogConfirmation
       response={logResponse}
       foodName={currentAnalysis?.food_name || "Food"}
       analysis={currentAnalysis ?? undefined}
       mealTypeId={mealTypeId}
       onReset={handleReset}
     />
     ```
   - Run: `npm test`
   - Verify: All tests pass

4. **REFACTOR** — Clean up:
   - Ensure the nutrition card is responsive on mobile (no horizontal overflow)
   - Verify dark mode compatibility (use theme-aware colors like `text-foreground`, `border`)

**Notes:**
- Reference `getUnitLabel()` at `src/types/index.ts:39` for amount+unit formatting
- The nutrition card should be compact — FDA-label style but simplified
- The `analysis` prop is optional to avoid breaking the reuse flow where `currentAnalysis` could differ

---

### Task 2: Auto-reconnect Fitbit on token expiry (FOO-168)

**Issue:** FOO-168
**Files:**
- `src/lib/pending-submission.ts` (create)
- `src/lib/__tests__/pending-submission.test.ts` (create)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer-reconnect.test.tsx` (create)

**TDD Steps:**

1. **RED** — Write tests for pending submission storage:
   - Create `src/lib/__tests__/pending-submission.test.ts`
   - Test: `savePendingSubmission(data)` stores to `sessionStorage` under key `"food-scanner-pending-submission"`
   - Test: `getPendingSubmission()` returns the stored data or `null`
   - Test: `clearPendingSubmission()` removes from `sessionStorage`
   - Test: handles `sessionStorage` being unavailable (try/catch, returns null)
   - Interface: `PendingSubmission = { analysis: FoodAnalysis; mealTypeId: number; foodName: string }`
   - Run: `npm test -- pending-submission`
   - Verify: Tests fail

2. **GREEN** — Implement `src/lib/pending-submission.ts`:
   - Export `PendingSubmission` interface
   - Export `savePendingSubmission`, `getPendingSubmission`, `clearPendingSubmission`
   - Use `sessionStorage.setItem/getItem/removeItem` with JSON serialization
   - Wrap in try/catch (sessionStorage may be unavailable in SSR or private browsing)
   - Run: `npm test -- pending-submission`
   - Verify: Tests pass

3. **RED** — Write tests for reconnect flow in `FoodAnalyzer`:
   - Create `src/components/__tests__/food-analyzer-reconnect.test.tsx`
   - Test: when `FITBIT_TOKEN_INVALID` is received, `savePendingSubmission` is called with current analysis + mealTypeId
   - Test: when `FITBIT_TOKEN_INVALID` is received, `window.location.href` is set to `/api/auth/fitbit`
   - Test: on mount, if pending submission exists, auto-submit to `/api/log-food` and show success
   - Test: on mount, if pending submission exists and resubmit fails, show error and clear pending
   - Test: non-token errors (rate limit, server error) still show inline error as today
   - Mock: `fetch`, `savePendingSubmission`, `getPendingSubmission`, `clearPendingSubmission`
   - Run: `npm test -- food-analyzer-reconnect`
   - Verify: Tests fail

4. **GREEN** — Modify `FoodAnalyzer`:
   - Import `savePendingSubmission`, `getPendingSubmission`, `clearPendingSubmission` from `@/lib/pending-submission`
   - In `handleLogToFitbit` (line 166): when `FITBIT_TOKEN_INVALID` is received:
     - Save `{ analysis: currentAnalysis, mealTypeId, foodName: currentAnalysis.food_name }` to `sessionStorage`
     - Redirect to `/api/auth/fitbit` via `window.location.href = "/api/auth/fitbit"`
     - Remove the static error message for this case
   - In `handleUseExisting` (line 205): same pattern for `FITBIT_TOKEN_INVALID`:
     - Save `{ analysis: null, mealTypeId, reuseCustomFoodId: match.customFoodId, foodName: match.foodName }` — extend `PendingSubmission` to support reuse
   - Add `useEffect` on mount to check for pending submission:
     - If found, set a new state `resubmitting: boolean` = true
     - Show a brief "Reconnected! Resubmitting..." message
     - Call `fetch("/api/log-food", ...)` with the stored payload
     - On success: set `logResponse`, clear pending
     - On failure: set `logError`, clear pending
     - Set `resubmitting` = false
   - The `/api/auth/fitbit` route already supports GET (line 36-37 of `src/app/api/auth/fitbit/route.ts`), so `window.location.href` will work
   - Fitbit callback already redirects to `/app` (line 70 of `src/app/api/auth/fitbit/callback/route.ts`)
   - Run: `npm test -- food-analyzer-reconnect`
   - Verify: Tests pass

5. **REFACTOR** — Clean up:
   - Ensure the "Reconnecting..." UI state is visually clear (spinner + message)
   - Ensure `resubmitting` blocks other interactions (disable buttons)

**Notes:**
- The Fitbit auth route at `/api/auth/fitbit` supports both GET and POST (line 36-37), so `window.location.href` redirect works
- Fitbit callback redirects to `/app` (line 70 of callback route), which re-mounts `FoodAnalyzer`
- `PendingSubmission` interface needs to handle both new food and reuse flows
- The analysis data for reuse flow can store `reuseCustomFoodId` instead of full analysis

---

### Task 3: Move photo analysis to `/app/analyze` (FOO-170 prerequisite)

**Issue:** FOO-170
**Files:**
- `src/app/app/analyze/page.tsx` (create)
- `src/app/app/page.tsx` (modify — will become quick select in Task 5)

**TDD Steps:**

1. **RED** — Write test for new analyze page:
   - Create `src/app/app/analyze/__tests__/page.test.tsx`
   - Test: renders `FoodAnalyzer` component
   - Test: redirects to `/` when no session
   - Mock `getSession` from `@/lib/session`
   - Run: `npm test -- app/analyze`
   - Verify: Tests fail

2. **GREEN** — Create `src/app/app/analyze/page.tsx`:
   - Copy the current content of `src/app/app/page.tsx` (session check + header + FoodAnalyzer)
   - Change the header to show "Analyze Food" instead of "Food Scanner"
   - Add a back link/button to `/app` (home icon or "Back" text)
   - Keep `<FoodAnalyzer />` rendering
   - Run: `npm test -- app/analyze`
   - Verify: Tests pass

3. **GREEN** — Update `FoodAnalyzer` `handleReset` for navigation:
   - After logging from `/app/analyze`, "Log Another" should navigate to `/app` (not stay on analyze)
   - Add optional `onLogSuccess?: () => void` prop to `FoodLogConfirmation`
   - In analyze page, pass `onReset` that navigates to `/app` via `useRouter().push("/app")`
   - Actually — keep it simple: `handleReset` in `FoodAnalyzer` just resets state (stays on same page). The "Log Another" from analyze page will reset the form on the analyze page. Navigating to `/app` (quick select) is done via the back button. Keep current behavior.

4. **REFACTOR** — Ensure middleware covers `/app/analyze`:
   - Middleware matcher already covers `/app/:path*` (line 41 of `middleware.ts`), so `/app/analyze` is protected. No change needed.

**Notes:**
- The middleware matcher `/app/:path*` already covers all sub-routes including `/app/analyze`
- Keep `FoodAnalyzer` component unchanged — it works the same on either page

---

### Task 4: Common foods DB query and API endpoint (FOO-170)

**Issue:** FOO-170
**Files:**
- `src/lib/food-log.ts` (modify — add `getCommonFoods` query)
- `src/lib/__tests__/food-log.test.ts` (modify — add tests for new query)
- `src/app/api/common-foods/route.ts` (create)
- `src/app/api/common-foods/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** — Write test for `getCommonFoods` DB query:
   - Add tests in `src/lib/__tests__/food-log.test.ts`
   - Test: returns foods from last 30 days with non-null `fitbitFoodId`
   - Test: deduplicates by `customFoodId` (keeps entry with smallest time diff)
   - Test: ranks by ascending time difference from provided `currentTime`
   - Test: limits to 5 results
   - Test: returns empty array when no entries exist
   - Interface: `CommonFood = { customFoodId, foodName, amount, unitId, calories, proteinG, carbsG, fatG, fiberG, sodiumMg, fitbitFoodId, mealTypeId }`
   - Signature: `getCommonFoods(email: string, currentTime: string): Promise<CommonFood[]>`
   - `currentTime` is `HH:mm:ss` format
   - Mock the DB: mock `getDb()` to return a mock that simulates the join query
   - Run: `npm test -- food-log`
   - Verify: New tests fail

2. **GREEN** — Implement `getCommonFoods` in `src/lib/food-log.ts`:
   - Join `foodLogEntries` to `customFoods` on `customFoodId`
   - Filter: `email = ?` AND `customFoods.fitbitFoodId IS NOT NULL` AND `foodLogEntries.date >= (now - 30 days)`
   - Select all needed fields from `customFoods` + `mealTypeId` from `foodLogEntries`
   - Use Drizzle query builder (no raw SQL per CLAUDE.md)
   - For time-of-day ranking: fetch all matching rows, then do the dedup + time-diff ranking in JS (Drizzle doesn't have `ABS(time - ?)` easily)
   - Time diff calculation: parse `HH:mm:ss` to minutes since midnight, compute circular distance (min of |a-b| and 1440-|a-b|)
   - Dedup: group by `customFoodId`, keep entry with smallest time diff
   - Sort ascending by time diff, limit 5
   - Run: `npm test -- food-log`
   - Verify: Tests pass

3. **RED** — Write test for `GET /api/common-foods`:
   - Create `src/app/api/common-foods/__tests__/route.test.ts`
   - Test: returns common foods for authenticated user
   - Test: returns 401 for unauthenticated user
   - Test: returns empty array when no history
   - Mock: `getSession`, `getCommonFoods`
   - Run: `npm test -- common-foods`
   - Verify: Tests fail

4. **GREEN** — Create `src/app/api/common-foods/route.ts`:
   - `GET` handler
   - Validate session via `getSession()` + `validateSession()`
   - Get current time: `new Date().toTimeString().slice(0, 8)` → `HH:mm:ss`
   - Call `getCommonFoods(session.email, currentTime)`
   - Return `successResponse({ foods })`
   - Run: `npm test -- common-foods`
   - Verify: Tests pass

**Notes:**
- The middleware matcher already covers `/api/common-foods` (it's not in the exclusion list `health|auth`)
- Time diff should be circular (23:00 is close to 01:00, only 2 hours apart)
- Export `CommonFood` interface from `src/lib/food-log.ts` and also add to `src/types/index.ts`
- The `mealTypeId` from the most recent entry is included so the quick select can pre-fill it (though Task 5 will auto-detect from current time per the spec)

---

### Task 5: Quick select home screen UI (FOO-170)

**Issue:** FOO-170
**Files:**
- `src/app/app/page.tsx` (rewrite — becomes quick select)
- `src/components/quick-select.tsx` (create)
- `src/components/__tests__/quick-select.test.tsx` (create)
- `src/components/food-analyzer.tsx` (modify — add `redirectTo` prop for post-log navigation)

**TDD Steps:**

1. **RED** — Write tests for `QuickSelect` component:
   - Create `src/components/__tests__/quick-select.test.tsx`
   - Test: renders loading state initially
   - Test: renders food cards when foods are returned from API
   - Test: each card shows food name, amount+unit, calories, macros
   - Test: renders empty state ("No recent foods") with "Take Photo" button when 0 results
   - Test: tapping a food card shows confirmation screen with nutrition details
   - Test: confirmation screen has "Log to Fitbit" button
   - Test: logging calls `/api/log-food` with `reuseCustomFoodId` + `mealTypeId`
   - Test: after successful log, shows success screen (FoodLogConfirmation)
   - Test: "Log Another" returns to quick select (not analyze)
   - Test: "Take Photo" buttons link to `/app/analyze`
   - Mock: `fetch` for `/api/common-foods` and `/api/log-food`
   - Run: `npm test -- quick-select`
   - Verify: Tests fail

2. **GREEN** — Create `src/components/quick-select.tsx`:
   - `"use client"` component
   - On mount, `fetch("/api/common-foods")` → set `foods` state
   - States: `loading`, `foods: CommonFood[]`, `selectedFood: CommonFood | null`, `logging`, `logError`, `logResponse`
   - Food list view: cards for each food (food name, `getUnitLabel(unitId, amount)`, calories, P/C/F badges)
   - Prominent "Take Photo" button at top and bottom linking to `/app/analyze`
   - When a food card is tapped → show detail/confirm view:
     - Nutrition facts card (reuse pattern from Task 1)
     - Meal type auto-selected via `getDefaultMealType()` (same logic as `FoodAnalyzer`)
     - `MealTypeSelector` to let user change it
     - "Log to Fitbit" button → `POST /api/log-food` with `{ reuseCustomFoodId, mealTypeId }`
     - "Back" button to return to food list
   - On successful log → show `FoodLogConfirmation` with analysis data from the selected food
   - `handleReset` returns to food list (refetch common foods)
   - Handle `FITBIT_TOKEN_INVALID` with same reconnect pattern from Task 2
   - Run: `npm test -- quick-select`
   - Verify: Tests pass

3. **GREEN** — Rewrite `src/app/app/page.tsx`:
   - Server component: check session, redirect if missing
   - Render `<QuickSelect />` instead of `<FoodAnalyzer />`
   - Keep header with "Food Scanner" title
   - Remove the Settings icon button (will be in bottom nav from Task 9)
   - Actually keep Settings link for now (Task 9 removes it)
   - Run: `npm test`
   - Verify: All tests pass

4. **REFACTOR** — Polish:
   - Ensure cards have 44px touch targets
   - Add haptic feedback on card tap
   - Loading skeleton for food cards

**Notes:**
- `CommonFood` type (from Task 4) provides all data needed for cards and the nutrition facts display
- Reuse `getDefaultMealType()` — extract from `food-analyzer.tsx` to a shared util if needed (or just duplicate, it's 7 lines)
- Reuse `FoodLogConfirmation` component for the success screen (with nutrition props from Task 1)
- The `FoodLogConfirmation` `onReset` callback should refetch common foods (not navigate away)

---

### Task 6: Food history DB queries (FOO-171)

**Issue:** FOO-171
**Files:**
- `src/lib/food-log.ts` (modify — add `getFoodLogHistory`, `deleteFoodLogEntry`)
- `src/lib/__tests__/food-log.test.ts` (modify — add tests)
- `src/types/index.ts` (modify — add `FoodLogHistoryEntry` interface)

**TDD Steps:**

1. **RED** — Write tests for `getFoodLogHistory`:
   - Test: returns entries joined with custom foods, ordered by `date DESC, time ASC`
   - Test: filters by email
   - Test: filters by date range (`startDate` to `endDate`)
   - Test: returns all needed fields (id, foodName, calories, proteinG, carbsG, fatG, fiberG, sodiumMg, amount, unitId, mealTypeId, date, time, fitbitLogId)
   - Test: supports cursor-based pagination (cursor = oldest date in result set)
   - Test: limits results (e.g., 20 per page)
   - Signature: `getFoodLogHistory(email: string, options: { endDate?: string, limit?: number }): Promise<FoodLogHistoryEntry[]>`
   - Run: `npm test -- food-log`
   - Verify: New tests fail

2. **GREEN** — Implement `getFoodLogHistory`:
   - Join `foodLogEntries` + `customFoods` on `customFoodId`
   - Filter: `email = ?` and optionally `date <= endDate`
   - Order: `date DESC, time ASC`
   - Limit: `options.limit ?? 20`
   - Return: array of `FoodLogHistoryEntry` objects
   - Run: `npm test -- food-log`
   - Verify: Tests pass

3. **RED** — Write tests for `deleteFoodLogEntry`:
   - Test: deletes the food log entry row by id
   - Test: returns the deleted entry's `fitbitLogId` (needed for Fitbit API delete)
   - Test: returns null when entry not found
   - Test: validates email matches (prevents deleting other users' entries)
   - Signature: `deleteFoodLogEntry(email: string, entryId: number): Promise<{ fitbitLogId: number | null } | null>`
   - Run: `npm test -- food-log`
   - Verify: Tests fail

4. **GREEN** — Implement `deleteFoodLogEntry`:
   - Select `fitbitLogId` from `foodLogEntries` where `id = ?` AND `email = ?`
   - If not found, return null
   - Delete the row
   - Return `{ fitbitLogId }`
   - Run: `npm test -- food-log`
   - Verify: Tests pass

**Notes:**
- Add `FoodLogHistoryEntry` to `src/types/index.ts`:
  ```typescript
  export interface FoodLogHistoryEntry {
    id: number;
    foodName: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    sodiumMg: number;
    amount: number;
    unitId: number;
    mealTypeId: number;
    date: string;
    time: string | null;
    fitbitLogId: number | null;
  }
  ```
- Cursor pagination: the client sends the oldest `date` from the current page as the `endDate` for the next page

---

### Task 7: Fitbit delete food log API (FOO-171)

**Issue:** FOO-171
**Files:**
- `src/lib/fitbit.ts` (modify — add `deleteFoodLog`)
- `src/lib/__tests__/fitbit.test.ts` (modify — add tests)

**TDD Steps:**

1. **RED** — Write test for `deleteFoodLog`:
   - Test: calls `DELETE /1/user/-/food/log/{food-log-id}.json` with Bearer token
   - Test: returns void on 204 success
   - Test: throws `FITBIT_TOKEN_INVALID` on 401
   - Test: retries on 429 and 5xx (same retry logic as other endpoints)
   - Test: throws `FITBIT_API_ERROR` on other errors
   - Signature: `deleteFoodLog(accessToken: string, fitbitLogId: number): Promise<void>`
   - Run: `npm test -- fitbit`
   - Verify: New tests fail

2. **GREEN** — Implement `deleteFoodLog`:
   - Use `fetchWithRetry` (already handles 401/429/5xx)
   - URL: `${FITBIT_API_BASE}/1/user/-/food/log/${fitbitLogId}.json`
   - Method: DELETE
   - Headers: `Authorization: Bearer ${accessToken}`
   - No body
   - Check `response.ok` — if not, parse error and throw `FITBIT_API_ERROR`
   - Return void (Fitbit returns 204 No Content on success)
   - Run: `npm test -- fitbit`
   - Verify: Tests pass

**Notes:**
- Fitbit API docs: `DELETE https://api.fitbit.com/1/user/-/food/log/{food-log-id}.json`
- The existing `fetchWithRetry` function already handles 401 → `FITBIT_TOKEN_INVALID` and 429 → retry

---

### Task 8: History API endpoints (FOO-171)

**Issue:** FOO-171
**Files:**
- `src/app/api/food-history/route.ts` (create)
- `src/app/api/food-history/__tests__/route.test.ts` (create)
- `src/app/api/food-history/[id]/route.ts` (create)
- `src/app/api/food-history/[id]/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** — Write test for `GET /api/food-history`:
   - Test: returns food log entries for authenticated user
   - Test: supports `endDate` query param for pagination
   - Test: supports `limit` query param
   - Test: returns 401 for unauthenticated user
   - Mock: `getSession`, `getFoodLogHistory`
   - Run: `npm test -- food-history/route`
   - Verify: Tests fail

2. **GREEN** — Create `src/app/api/food-history/route.ts`:
   - `GET` handler
   - Validate session
   - Parse query params: `endDate` (optional), `limit` (optional, default 20, max 50)
   - Call `getFoodLogHistory(email, { endDate, limit })`
   - Return `successResponse({ entries })`
   - Run: `npm test -- food-history/route`
   - Verify: Tests pass

3. **RED** — Write test for `DELETE /api/food-history/[id]`:
   - Test: deletes entry from local DB and Fitbit
   - Test: deletes local only if `fitbitLogId` is null
   - Test: returns 401 for unauthenticated user
   - Test: returns 404 if entry not found
   - Test: returns error if Fitbit delete fails (local entry NOT deleted)
   - Test: handles `FITBIT_TOKEN_INVALID` → returns 401
   - Mock: `getSession`, `deleteFoodLogEntry`, `ensureFreshToken`, `deleteFoodLog`
   - Run: `npm test -- food-history/\\[id\\]`
   - Verify: Tests fail

4. **GREEN** — Create `src/app/api/food-history/[id]/route.ts`:
   - `DELETE` handler
   - Validate session (require Fitbit connected)
   - Parse `id` from route params (convert to number)
   - Call `deleteFoodLogEntry(email, id)` → get `fitbitLogId`
   - If null (entry not found), return 404
   - If `fitbitLogId` exists:
     - Get fresh token via `ensureFreshToken(email)`
     - Call `deleteFoodLog(accessToken, fitbitLogId)`
     - If Fitbit delete fails, return error (entry stays in DB — it wasn't deleted yet)
   - Wait — need to rethink: delete from Fitbit FIRST, then delete from local DB. That way if Fitbit fails, local DB is untouched.
   - Updated flow:
     1. Look up entry → get `fitbitLogId`
     2. If `fitbitLogId` exists: delete from Fitbit
     3. Delete from local DB
     4. Return success
   - Need a separate "lookup" function or modify `deleteFoodLogEntry` to be a two-step process
   - Better: add `getFoodLogEntry(email, id)` to `src/lib/food-log.ts` for lookup, keep `deleteFoodLogEntry` for the actual delete
   - Run: `npm test -- food-history/\\[id\\]`
   - Verify: Tests pass

**Notes:**
- Delete order per issue spec: "delete from Fitbit first, then delete locally. If Fitbit delete fails, don't delete locally."
- Need `getFoodLogEntry(email, id)` for the lookup step and `deleteFoodLogEntry(email, id)` for the actual DB delete
- Add the lookup function in Task 6 (add to `food-log.ts`)
- The middleware matcher already covers `/api/food-history` (not excluded by `health|auth`)
- Update CLAUDE.md API table with new endpoints at the end

---

### Task 9: Food history page UI (FOO-171)

**Issue:** FOO-171
**Files:**
- `src/app/app/history/page.tsx` (create)
- `src/components/food-history.tsx` (create)
- `src/components/__tests__/food-history.test.tsx` (create)

**TDD Steps:**

1. **RED** — Write tests for `FoodHistory` component:
   - Test: renders loading state
   - Test: renders entries grouped by date
   - Test: each entry shows food name, calories, macros, amount+unit, meal type, time
   - Test: each date group shows daily summary (total calories, protein, carbs, fat)
   - Test: renders empty state when no entries
   - Test: delete button calls `DELETE /api/food-history/{id}` and removes entry from UI
   - Test: delete handles errors gracefully (shows error, keeps entry)
   - Test: "Load more" triggers fetch with oldest date as cursor
   - Mock: `fetch`
   - Run: `npm test -- food-history`
   - Verify: Tests fail

2. **GREEN** — Create `src/components/food-history.tsx`:
   - `"use client"` component
   - On mount, fetch `/api/food-history`
   - State: `entries: FoodLogHistoryEntry[]`, `loading`, `loadingMore`, `hasMore`, `error`
   - Group entries by `date` for display
   - For each date group:
     - Date header (formatted: "Today", "Yesterday", "Feb 5", etc.)
     - Daily summary: total cal, protein, carbs, fat
     - Entry rows: time (if available), food name, calories, P/C/F, amount+unit, meal type, delete button
   - Delete handler:
     - Confirm via `window.confirm("Delete this entry?")` or shadcn AlertDialog
     - `DELETE /api/food-history/${id}`
     - On success: remove entry from state
     - On failure: show error toast/message
   - Load more: button at bottom (or intersection observer for infinite scroll)
     - Fetch `/api/food-history?endDate=${oldestDate}&limit=20`
     - Append to existing entries
     - Set `hasMore = false` when result has fewer entries than limit
   - Date picker: shadcn Calendar + Popover for jumping to a date
     - On date select: clear entries, fetch with `endDate = selectedDate`
   - Run: `npm test -- food-history`
   - Verify: Tests pass

3. **GREEN** — Create `src/app/app/history/page.tsx`:
   - Server component: check session, redirect if missing
   - Render header "History" + `<FoodHistory />`
   - Temporary back link to `/app`
   - Run: `npm test`
   - Verify: All tests pass

4. **REFACTOR** — Polish:
   - Ensure delete button has 44px touch target
   - Add haptic feedback on delete
   - Skeleton loading for entries
   - Add shadcn `calendar` component if not yet installed (check `src/components/ui/`)
   - Note: `calendar` needs `react-day-picker` dependency — install if needed: `npm install react-day-picker`
   - Also need shadcn `popover` — already exists at `src/components/ui/` (check)

**Notes:**
- The shadcn Calendar component requires `react-day-picker` package
- Check if `src/components/ui/calendar.tsx` exists; if not, install it: `npx shadcn@latest add calendar`
- Middleware already covers `/app/history` via `/app/:path*` matcher
- `getUnitLabel()` from `src/types/index.ts` for formatting amount+unit
- `FITBIT_MEAL_TYPE_LABELS` (added in Task 1) for meal type display

---

### Task 10: Add bottom navigation bar (FOO-173)

**Issue:** FOO-173
**Files:**
- `src/components/bottom-nav.tsx` (create)
- `src/components/__tests__/bottom-nav.test.tsx` (create)
- `src/app/app/layout.tsx` (create — shared layout for `/app/*` routes)
- `src/app/settings/layout.tsx` (create — includes bottom nav for settings)
- `src/app/app/page.tsx` (modify — remove Settings link from header)
- `src/app/app/analyze/page.tsx` (modify — remove back link, nav handles it)
- `src/app/app/history/page.tsx` (modify — remove temp back link)

**TDD Steps:**

1. **RED** — Write tests for `BottomNav`:
   - Create `src/components/__tests__/bottom-nav.test.tsx`
   - Test: renders three nav items (Home, History, Settings)
   - Test: Home links to `/app`
   - Test: History links to `/app/history`
   - Test: Settings links to `/settings`
   - Test: active route is visually highlighted (use `aria-current="page"`)
   - Test: all touch targets are at least 44x44px (check `min-h-[44px] min-w-[44px]`)
   - Mock: `usePathname` from `next/navigation`
   - Run: `npm test -- bottom-nav`
   - Verify: Tests fail

2. **GREEN** — Create `src/components/bottom-nav.tsx`:
   - `"use client"` component (needs `usePathname`)
   - Import icons from `lucide-react`: `Home`, `Clock` (history), `Settings`
   - Three nav items in a fixed-bottom bar:
     ```tsx
     <nav className="fixed bottom-0 left-0 right-0 bg-background border-t z-50">
       <div className="flex justify-around items-center max-w-md mx-auto">
         {items.map(item => (
           <Link
             key={item.href}
             href={item.href}
             className={cn("flex flex-col items-center min-h-[44px] min-w-[44px] ...", active && "text-primary")}
             aria-current={active ? "page" : undefined}
           >
             <item.icon className="h-5 w-5" />
             <span className="text-xs">{item.label}</span>
           </Link>
         ))}
       </div>
     </nav>
     ```
   - Active detection: `pathname === item.href` or `pathname.startsWith(item.href)` for nested routes
     - Home: active when `pathname === "/app"` or `pathname === "/app/analyze"`
     - History: active when `pathname === "/app/history"`
     - Settings: active when `pathname === "/settings"`
   - Safe area padding for PWA (standalone mode): `pb-[env(safe-area-inset-bottom)]`
   - Run: `npm test -- bottom-nav`
   - Verify: Tests pass

3. **GREEN** — Create `src/app/app/layout.tsx`:
   - Server component layout shared by all `/app/*` routes
   - Wrap children + render `<BottomNav />`
   - Add bottom padding to content area so it doesn't overlap the nav:
     ```tsx
     export default function AppLayout({ children }: { children: React.ReactNode }) {
       return (
         <>
           <div className="pb-20">{children}</div>
           <BottomNav />
         </>
       );
     }
     ```

4. **GREEN** — Create `src/app/settings/layout.tsx`:
   - Same pattern: wrap children + `<BottomNav />`
   - Settings is outside `/app/` path, so it needs its own layout

5. **GREEN** — Clean up headers:
   - `src/app/app/page.tsx`: remove Settings icon button from header
   - `src/app/app/analyze/page.tsx`: remove standalone back link (nav provides it)
   - `src/app/app/history/page.tsx`: remove temporary back link to `/app`
   - Run: `npm test`
   - Verify: All tests pass

6. **REFACTOR** — Polish:
   - Ensure nav doesn't overlap content (padding is sufficient)
   - Test in PWA standalone mode (no browser chrome)
   - Dark mode compatibility
   - Ensure `max-w-md mx-auto` matches the content width

**Notes:**
- The bottom nav must be in BOTH `src/app/app/layout.tsx` (for `/app/*` routes) and `src/app/settings/layout.tsx` (for `/settings`), since they're different route groups
- Alternatively, put it in `src/app/layout.tsx` (root) and conditionally show it based on route. But that makes the root layout a client component. Better to duplicate in two layouts.
- `lucide-react` is already a dependency (used throughout the app)
- FOO-173 spec says to remove the temporary nav link from FOO-171 — handle this in the header cleanup step

---

### Task 11: Update documentation (All issues)

**Issue:** FOO-168, FOO-169, FOO-170, FOO-171, FOO-173
**Files:**
- `CLAUDE.md` (modify — update structure, API endpoints, components list)

**Steps:**

1. Update STRUCTURE section:
   - Add `src/app/app/analyze/page.tsx` — Photo analysis page
   - Add `src/app/app/history/page.tsx` — Food log history
   - Add `src/app/app/layout.tsx` — Shared app layout with bottom nav
   - Add `src/app/settings/layout.tsx` — Settings layout with bottom nav
   - Add `src/app/api/common-foods/route.ts` — Common foods for quick select
   - Add `src/app/api/food-history/route.ts` — Food log history
   - Add `src/app/api/food-history/[id]/route.ts` — Delete food log entry
   - Add `src/lib/pending-submission.ts` — sessionStorage for reconnect flow
   - Update `src/app/app/page.tsx` description — Quick select home screen
   - Update `src/components/` list — add new components

2. Update API ENDPOINTS table:
   - Add `GET /api/common-foods` — Common foods (quick select)
   - Add `GET /api/food-history` — Food log history
   - Add `DELETE /api/food-history/[id]` — Delete food log entry

3. Verify no other docs need updating (`README.md`, `DEVELOPMENT.md` — likely no changes needed as these are about deployment/setup, not features)

---

### Task 12: Integration & Verification

**Issue:** FOO-168, FOO-169, FOO-170, FOO-171, FOO-173
**Files:** Various from all tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Success screen shows nutrition facts card after logging
   - [ ] Token expiry triggers auto-reconnect flow
   - [ ] After reconnect, food is auto-resubmitted
   - [ ] `/app` shows quick select with common foods
   - [ ] `/app/analyze` shows photo analysis flow
   - [ ] Tapping a common food shows confirm + logs to Fitbit
   - [ ] `/app/history` shows entries grouped by date
   - [ ] Delete removes from Fitbit and local DB
   - [ ] Bottom nav works on all protected routes
   - [ ] Active route is highlighted in bottom nav
   - [ ] All touch targets are 44px+
   - [ ] Dark mode works correctly on all new screens
   - [ ] PWA standalone mode works correctly

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |
| Linear | `create_comment` | Add progress notes to issues if needed |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---|---|---|
| `FITBIT_TOKEN_INVALID` during log | Auto-redirect to Fitbit OAuth, resubmit on return | Unit test (Task 2) |
| `FITBIT_TOKEN_INVALID` during resubmit | Show error, clear pending data | Unit test (Task 2) |
| `sessionStorage` unavailable | Graceful fallback — show error message as today | Unit test (Task 2) |
| Common foods query returns 0 results | Empty state with "Take Photo" CTA | Unit test (Task 5) |
| History fetch fails | Error message with retry option | Unit test (Task 9) |
| Fitbit delete fails | Entry kept in local DB, error shown | Unit test (Task 8) |
| Delete entry not found | 404 response | Unit test (Task 8) |

## Risks & Open Questions

- [ ] The shadcn `calendar` component may need `react-day-picker` installed — verify during implementation
- [ ] The `popover` component may already be installed — verify in `src/components/ui/`
- [ ] Time-of-day ranking uses circular distance — needs careful testing near midnight
- [ ] Bottom nav on Settings page requires its own layout since `/settings` is outside `/app/`
- [ ] `getCommonFoods` query does the time-diff ranking in JS (not SQL) — acceptable for <=30 days of data

## Scope Boundaries

**In Scope:**
- Nutrition facts card on success screen
- Auto-reconnect Fitbit with pending submission persistence
- Quick select home screen with time-based food suggestions
- Photo analysis moved to `/app/analyze`
- Food log history with date grouping and deletion
- Bottom navigation bar across protected routes
- Documentation updates

**Out of Scope:**
- Offline support / service worker
- Push notifications
- Food search within history
- Editing existing food log entries
- Sharing or export features
- Multi-user support
