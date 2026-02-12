# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-336-fasting-and-weekly-dashboard
**Issues:** FOO-336, FOO-337, FOO-338, FOO-339, FOO-340, FOO-341, FOO-342, FOO-343, FOO-344
**Created:** 2026-02-12
**Last Updated:** 2026-02-12

## Summary

Implement two feature groups: (1) Fasting window tracking on the daily dashboard with a live counter, and (2) a weekly nutrition dashboard with calorie charts, macro averages, fasting durations, and historical calorie goal storage. These features add trend visibility and fasting awareness to the food scanner app.

## Issues

### FOO-336: Fasting window calculation logic

**Priority:** Medium
**Labels:** Feature
**Description:** Pure library function to compute overnight fasting duration from food log entries. Takes two consecutive days of entries, finds MAX(time) from previous day and MIN(time) from current day, computes the duration.

**Acceptance Criteria:**
- [ ] Function returns fasting window (times + duration) when both days have entries
- [ ] Function returns null when previous day has no entries
- [ ] Function supports single-date and date-range modes
- [ ] Duration correctly crosses midnight

### FOO-337: Fasting window card on daily dashboard

**Priority:** Medium
**Labels:** Feature
**Description:** API route and UI card showing overnight fasting duration on the daily dashboard. Card displays duration (e.g., "14h 30m") and time range (e.g., "9:15 PM → 11:45 AM"). Placed below macro bars, above meal breakdown.

**Acceptance Criteria:**
- [ ] API route `/api/fasting?date=YYYY-MM-DD` returns fasting data
- [ ] Card displays fasting duration and time range
- [ ] Card shows "No data" when fasting window unavailable
- [ ] Card appears between macro bars and meal breakdown on daily dashboard

### FOO-338: Live fasting counter when today has no meals

**Priority:** Medium
**Labels:** Feature
**Description:** When the user opens the app before eating, show a live-updating counter of the ongoing fast (previous day's last meal → now). Updates every 60 seconds. Transitions to static display when first meal is logged.

**Acceptance Criteria:**
- [ ] Live counter shows when date is today and no meals logged today
- [ ] Counter updates every 60 seconds
- [ ] Visual "live" indicator distinguishes from static display
- [ ] Transitions to static on SWR revalidation after first meal

### FOO-339: Extend nutrition summary API for date ranges

**Priority:** Medium
**Labels:** Feature
**Description:** Add `from` and `to` query params to `/api/nutrition-summary`. When present, returns array of per-day calorie/macro totals (one entry per day with data). Existing single-date `?date=` behavior unchanged.

**Acceptance Criteria:**
- [ ] `?from=YYYY-MM-DD&to=YYYY-MM-DD` returns array of daily totals
- [ ] Each day includes calorie goal from `daily_calorie_goals` table (or null)
- [ ] Days with no entries are omitted from the array
- [ ] Existing `?date=` single-day behavior is unchanged
- [ ] Validation rejects invalid date ranges

### FOO-340: Store daily Fitbit calorie goals for historical access

**Priority:** High
**Labels:** Feature
**Description:** New `daily_calorie_goals` DB table stores the calorie goal per user per date. Captured as a fire-and-forget side effect each time `/api/nutrition-goals` successfully fetches from Fitbit. Enables the weekly chart to show per-day goal markers and fixes the daily view showing wrong goals on past dates.

**Acceptance Criteria:**
- [ ] New `daily_calorie_goals` table with userId + date unique constraint
- [ ] Upsert goal on every successful `/api/nutrition-goals` fetch
- [ ] Side effect is fire-and-forget (doesn't block the response)
- [ ] Date range nutrition API includes stored goals per day

**Migration note:** New `daily_calorie_goals` table. No existing data affected. Schema-only change.

### FOO-341: Daily/Weekly dashboard toggle

**Priority:** Medium
**Labels:** Feature
**Description:** Segmented control above the dashboard to switch between Daily and Weekly views. Parent shell component manages toggle state. DailyDashboard stays as-is; new WeeklyDashboard component for weekly view with week navigation (Sunday–Saturday boundaries).

**Acceptance Criteria:**
- [ ] Toggle between "Daily" and "Weekly" views
- [ ] Default to Daily view
- [ ] Weekly view has week navigation (left/right arrows shifting by 7 days)
- [ ] Week boundaries are Sunday–Saturday
- [ ] Week label shows date range (e.g., "Feb 9 – 15")

### FOO-342: Weekly calorie bar chart with per-day goals

**Priority:** Medium
**Labels:** Feature
**Description:** 7 vertical bars (Sun–Sat) showing daily calorie intake. Per-day goal marker (horizontal tick) on each bar from stored calorie goals. Bars colored green if under goal, amber/red if over. CSS/div implementation (no chart library).

**Acceptance Criteria:**
- [ ] 7 bars for Sun–Sat, proportional height to calories consumed
- [ ] Per-day goal marker from `daily_calorie_goals`
- [ ] Green bars under goal, amber/red over goal
- [ ] Empty/dimmed columns for days without data or future days
- [ ] Empty state message when no data available

### FOO-343: Weekly macro averages display

**Priority:** Medium
**Labels:** Feature
**Description:** Average daily protein/carbs/fat across days with logged data. Displayed below the calorie chart. Averages over logged days only (3 logged days = divide by 3, not 7).

**Acceptance Criteria:**
- [ ] Shows average protein, carbs, fat across days with data
- [ ] Averages computed over days with entries only
- [ ] Display format similar to existing MacroBars component
- [ ] Shows "No data" when no days have entries

### FOO-344: Weekly fasting durations per day

**Priority:** Low
**Labels:** Feature
**Description:** Per-day fasting duration display in the weekly view. Each day shows its overnight fast duration. Requires fetching one extra day before week start for Sunday's fasting calculation.

**Acceptance Criteria:**
- [ ] Shows per-day fasting duration for each day of the week
- [ ] Sunday's fasting uses Saturday's data (extra day fetch)
- [ ] Days without valid fasting data show as empty
- [ ] Reuses fasting calculation logic from FOO-336

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Database migrations are up to date
- [ ] `npm install` completed

## Important Notes for Implementers

**`time` column is NOT NULL:** The `food_log_entries.time` column has a `.notNull()` constraint in the schema (`src/db/schema.ts:82`). The issue descriptions mention nullable times — this is incorrect. Every food log entry has a time value. The fasting calculation does NOT need to filter out null-time entries. Handle "no entries for a day" as the null data case instead.

**No chart library:** FOO-342 explicitly calls for CSS/div-based bar chart implementation. Do not add Recharts or similar dependencies.

**Fire-and-forget pattern:** For the calorie goal capture in FOO-340, follow the same pattern used in `src/lib/lumen.ts:157-168` for `recordUsage` — call the async function and `.catch()` to log warnings without blocking the response.

## Implementation Tasks

### Task 1: Add shared types for fasting and weekly features

**Issue:** FOO-336, FOO-339, FOO-340
**Files:**
- `src/types/index.ts` (modify)

**TDD Steps:**

1. **RED** — No test needed for type definitions (compile-time checked).

2. **GREEN** — Add new interfaces to `src/types/index.ts`:
   - `FastingWindow`: `date: string`, `lastMealTime: string` (HH:mm:ss), `firstMealTime: string | null`, `durationMinutes: number | null`
   - `FastingResponse`: `window: FastingWindow | null`, `live: { lastMealTime: string; startDate: string } | null`
   - `DailyNutritionTotals`: `date: string`, `calories: number`, `proteinG: number`, `carbsG: number`, `fatG: number`, `fiberG: number`, `sodiumMg: number`, `calorieGoal: number | null`
   - `DateRangeNutritionResponse`: `days: DailyNutritionTotals[]`

   Place after the existing `ClaudeUsageResponse` interface at the bottom of the file.

3. **REFACTOR** — Run `npm run typecheck` to verify no conflicts.

---

### Task 2: Create daily_calorie_goals DB table and storage logic

**Issue:** FOO-340
**Files:**
- `src/db/schema.ts` (modify)
- `src/lib/nutrition-goals.ts` (create)
- `src/lib/__tests__/nutrition-goals.test.ts` (create)

**Dependencies:** Task 1

**TDD Steps:**

1. **RED** — Write tests in `src/lib/__tests__/nutrition-goals.test.ts`:
   - Test `upsertCalorieGoal(userId, date, calorieGoal)` inserts a new row
   - Test `upsertCalorieGoal` updates existing row for same userId+date
   - Test `getCalorieGoalsByDateRange(userId, fromDate, toDate)` returns array of `{ date, calorieGoal }` for dates in range
   - Test `getCalorieGoalsByDateRange` returns empty array when no goals stored
   - Mock pattern: follow `src/lib/__tests__/food-log.test.ts` DB mock approach

2. **GREEN** — Implement:
   - Add `dailyCalorieGoals` table to `src/db/schema.ts` following `lumenGoals` pattern: `id` (serial PK), `userId` (uuid FK → users), `date` (date), `calorieGoal` (integer, not null), `createdAt`, `updatedAt`, plus `unique("daily_calorie_goals_user_date_uniq").on(table.userId, table.date)`
   - Create `src/lib/nutrition-goals.ts` with `upsertCalorieGoal` and `getCalorieGoalsByDateRange` functions
   - `upsertCalorieGoal`: insert with `onConflictDoUpdate` on userId+date (same pattern as `upsertLumenGoals` in `src/lib/lumen.ts:187-211`)
   - `getCalorieGoalsByDateRange`: select where userId matches and date is between from/to, ordered by date ASC

3. **REFACTOR** — Run `npx drizzle-kit generate` to create the migration file. Verify it looks correct. **Do NOT hand-write the migration or snapshot.**

**Migration note:** New `daily_calorie_goals` table. Schema-only, no existing data affected.

**Notes:**
- Reference `src/lib/lumen.ts:187-211` for the upsert pattern
- Reference `src/db/schema.ts:86-102` (lumenGoals) for the table definition pattern

---

### Task 3: Capture calorie goal in nutrition-goals route

**Issue:** FOO-340
**Files:**
- `src/app/api/nutrition-goals/route.ts` (modify)
- `src/app/api/nutrition-goals/__tests__/route.test.ts` (modify)

**Dependencies:** Task 2

**TDD Steps:**

1. **RED** — Add test in route test file:
   - Test that `upsertCalorieGoal` is called with userId and today's date after successful Fitbit fetch
   - Test that if `upsertCalorieGoal` throws, the response is still returned successfully (fire-and-forget)
   - Add mock for `upsertCalorieGoal` from `@/lib/nutrition-goals`

2. **GREEN** — Modify `src/app/api/nutrition-goals/route.ts`:
   - Import `upsertCalorieGoal` from `@/lib/nutrition-goals`
   - After the `getFoodGoals` call succeeds and before returning the response, fire-and-forget: call `upsertCalorieGoal(session!.userId, todayDate, goals.calories)` with `.catch()` to log warnings (follow the `recordUsage` pattern in `src/lib/lumen.ts:157-168`)
   - Only upsert when `goals.calories` is not null
   - Use `getTodayDate()` from `@/lib/date-utils` for today's date

3. **REFACTOR** — Ensure the fire-and-forget call doesn't affect response timing.

**Notes:**
- Reference `src/lib/lumen.ts:157-168` for fire-and-forget pattern
- The upsert only fires on success — error paths skip it naturally

---

### Task 4: Fasting window calculation logic

**Issue:** FOO-336
**Files:**
- `src/lib/fasting.ts` (create)
- `src/lib/__tests__/fasting.test.ts` (create)

**Dependencies:** Task 1

**TDD Steps:**

1. **RED** — Write tests in `src/lib/__tests__/fasting.test.ts`:
   - Test `getFastingWindow(userId, date)`:
     - Returns fasting window when both days have entries (e.g., previous day last meal at 21:15, current day first meal at 11:45 → 870 minutes)
     - Returns `{ firstMealTime: null, durationMinutes: null }` when current day has no entries but previous day does (ongoing fast case)
     - Returns null when previous day has no entries
     - Returns null when neither day has entries
     - Correctly computes cross-midnight duration
   - Test `getFastingWindows(userId, fromDate, toDate)`:
     - Returns array of completed fasting windows for date range
     - Queries entries from (fromDate - 1) through toDate
     - Omits days without fasting data
     - Handles mixed days (some with data, some without)
   - Mock pattern: mock `getDb()` from `@/db/index`, mock `select().from().where()` chain

2. **GREEN** — Create `src/lib/fasting.ts`:
   - `getFastingWindow(userId, date)`: queries `food_log_entries` for `date` and `addDays(date, -1)`, finds MAX(time) from previous day and MIN(time) from current day, computes duration as `firstMealMinutes + 1440 - lastMealMinutes`
   - `getFastingWindows(userId, fromDate, toDate)`: single query for entries from `addDays(fromDate, -1)` through `toDate`, groups by date, computes per-day fasting windows, returns array
   - Import `addDays` from `@/lib/date-utils` for date arithmetic
   - Import `foodLogEntries` from `@/db/schema`, `getDb` from `@/db/index`
   - Return type: `FastingWindow | null` for single, `FastingWindow[]` for range

3. **REFACTOR** — Extract time-to-minutes parsing helper (similar to `parseTimeToMinutes` in `src/lib/food-log.ts:106-110`). Consider importing or duplicating — the existing one is not exported, so define a local version.

**Notes:**
- `time` column is NOT NULL (`src/db/schema.ts:82`) — no null-time filtering needed
- Duration formula: `firstMealMinutes + 1440 - lastMealMinutes` (always crosses midnight by definition)
- Reference `src/lib/food-log.ts:106-110` for `parseTimeToMinutes` pattern

---

### Task 5: Date range nutrition summary lib function

**Issue:** FOO-339
**Files:**
- `src/lib/food-log.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify)

**Dependencies:** Task 1, Task 2

**TDD Steps:**

1. **RED** — Add tests in `src/lib/__tests__/food-log.test.ts`:
   - Test `getDateRangeNutritionSummary(userId, fromDate, toDate)`:
     - Returns array of daily totals for days with entries
     - Each day has `date`, `calories`, `proteinG`, `carbsG`, `fatG`, `fiberG`, `sodiumMg`, `calorieGoal`
     - Days without entries are omitted
     - Calories/macros are aggregated correctly across multiple meals per day
     - `calorieGoal` comes from `daily_calorie_goals` join (or null if no stored goal)

2. **GREEN** — Add `getDateRangeNutritionSummary` function to `src/lib/food-log.ts`:
   - Query `food_log_entries` joined with `custom_foods` where `date >= fromDate AND date <= toDate` and `userId` matches
   - Left join `daily_calorie_goals` on userId + date to get per-day goals
   - Group results by date in application code
   - For each date group, sum calories and macros (same aggregation as `getDailyNutritionSummary` but without per-meal breakdown)
   - Return `DailyNutritionTotals[]` ordered by date ASC
   - Import `dailyCalorieGoals` from schema and `getCalorieGoalsByDateRange` from `@/lib/nutrition-goals`

3. **REFACTOR** — Consider whether to do the calorie goals join at DB level or make a separate query. A separate query to `getCalorieGoalsByDateRange` may be simpler and avoids a complex multi-table join. Merge the results in application code by date.

**Notes:**
- Reference `getDailyNutritionSummary` in `src/lib/food-log.ts:647-783` for the aggregation pattern
- The date range version only needs daily totals, not per-meal breakdown — simpler than single-day
- Import `DailyNutritionTotals` from `@/types`

---

### Task 6: Extend nutrition-summary route for date ranges

**Issue:** FOO-339
**Files:**
- `src/app/api/nutrition-summary/route.ts` (modify)
- `src/app/api/nutrition-summary/__tests__/route.test.ts` (modify)

**Dependencies:** Task 5

**TDD Steps:**

1. **RED** — Add tests in route test file:
   - Test `?from=2024-01-15&to=2024-01-21` returns array of daily totals
   - Test `?from=&to=` with missing values returns 400 VALIDATION_ERROR
   - Test `?from=2024-01-21&to=2024-01-15` (from > to) returns 400 VALIDATION_ERROR
   - Test existing `?date=` behavior is unchanged (existing tests still pass)
   - Test `?date=` and `?from=&to=` are mutually exclusive — if both provided, `date` takes precedence
   - Mock `getDateRangeNutritionSummary` from `@/lib/food-log`

2. **GREEN** — Modify `src/app/api/nutrition-summary/route.ts`:
   - After session validation and URL parsing, check for `from` and `to` params
   - If `from` and `to` are present (and `date` is absent), validate both are valid dates and `from <= to`
   - Call `getDateRangeNutritionSummary(userId, from, to)` and return wrapped in `successResponse`
   - Existing `?date=` path unchanged
   - Apply the same `isValidDateFormat` validation to both `from` and `to`

3. **REFACTOR** — Extract common validation logic if it reduces duplication.

**Notes:**
- Reference existing route structure in `src/app/api/nutrition-summary/route.ts`
- Follow existing `isValidDateFormat` for validation
- Set same `Cache-Control: private, no-cache` header for date range responses

---

### Task 7: Fasting API route

**Issue:** FOO-337, FOO-344
**Files:**
- `src/app/api/fasting/route.ts` (create)
- `src/app/api/fasting/__tests__/route.test.ts` (create)

**Dependencies:** Task 4

**TDD Steps:**

1. **RED** — Write tests in `src/app/api/fasting/__tests__/route.test.ts`:
   - Test `?date=2024-01-15` with completed fast returns `{ window: {...}, live: null }`
   - Test `?date=2024-01-15` with no previous day data returns `{ window: null, live: null }`
   - Test `?date=today` with no meals today returns `{ window: null, live: { lastMealTime, startDate } }` (ongoing fast)
   - Test `?date=today` with no meals today AND no meals yesterday returns `{ window: null, live: null }`
   - Test `?from=2024-01-15&to=2024-01-21` returns `{ windows: [...] }` (date range)
   - Test missing date returns 400
   - Test invalid date returns 400
   - Test missing session returns 401
   - Mock pattern: follow `src/app/api/nutrition-summary/__tests__/route.test.ts`

2. **GREEN** — Create `src/app/api/fasting/route.ts`:
   - Session auth: `getSession()` + `validateSession()` (browser-facing route pattern)
   - Parse query params: `date` for single day, `from`/`to` for date range
   - Single day: call `getFastingWindow(userId, date)`, determine if live mode (date is today + window has null firstMealTime)
   - Date range: call `getFastingWindows(userId, from, to)`, return as `{ windows: [...] }`
   - Return `FastingResponse` for single day, `{ windows: FastingWindow[] }` for range
   - Set `Cache-Control: private, no-cache`
   - Log with `logger.info`

3. **REFACTOR** — Ensure consistent error handling matching other API routes.

**Notes:**
- Follow `src/app/api/nutrition-summary/route.ts` as the pattern for session auth + param validation
- The "live" field is only populated when `date` equals today AND `firstMealTime` is null — for past dates, `live` is always null
- `isToday()` from `@/lib/date-utils` to check if date is today

---

### Task 8: Fasting card component with live counter

**Issue:** FOO-337, FOO-338
**Files:**
- `src/components/fasting-card.tsx` (create)
- `src/components/__tests__/fasting-card.test.tsx` (create)

**Dependencies:** Task 7

**TDD Steps:**

1. **RED** — Write tests in `src/components/__tests__/fasting-card.test.tsx`:
   - Test renders fasting duration (e.g., "14h 30m") and time range when completed fast
   - Test renders "No data" when both `window` and `live` are null
   - Test renders live counter with visual indicator when `live` is present
   - Test live counter displays duration from `lastMealTime` to now
   - Test live counter calls `setInterval` with 60s interval
   - Test cleanup of interval on unmount
   - Use `vi.useFakeTimers()` for timer tests
   - Mock SWR response for fasting data

2. **GREEN** — Create `src/components/fasting-card.tsx`:
   - `"use client"` component
   - Accept `date: string` prop (the selected date)
   - Fetch fasting data via `useSWR<FastingResponse>(`/api/fasting?date=${date}`, apiFetcher)` following the pattern in `src/components/daily-dashboard.tsx:87-96`
   - **Completed fast:** Display duration formatted as "Xh Ym" and time range formatted as "HH:MM PM → HH:MM AM" (12-hour format)
   - **Live mode:** Display live duration with a pulsing dot indicator. Use `useState` + `useEffect` with `setInterval(60_000)` to update the counter every minute. Calculate duration from `live.lastMealTime` on `live.startDate` to `Date.now()`
   - **No data:** Display "No data" in muted text
   - Card styling: match existing card patterns in the dashboard (border, rounded-lg, padding)
   - Loading state: `Skeleton` placeholder while SWR loading

3. **REFACTOR** — Extract duration formatting helper (minutes → "Xh Ym" string). Extract time formatting helper (HH:mm:ss → "H:MM AM/PM").

**Notes:**
- Reference `src/components/daily-dashboard.tsx` for SWR + apiFetcher pattern
- Reference `src/components/calorie-ring.tsx` for card-like UI pattern
- Timer cleanup pattern: return cleanup function from `useEffect`
- **Vitest fake timers + setInterval:** Set up assertions BEFORE advancing time with `vi.advanceTimersByTimeAsync()` (per lesson in MEMORY.md)

---

### Task 9: Add fasting card to daily dashboard

**Issue:** FOO-337
**Files:**
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**Dependencies:** Task 8

**TDD Steps:**

1. **RED** — Add test in dashboard test file:
   - Test that `FastingCard` component is rendered in the dashboard
   - Test it receives the `selectedDate` prop
   - Test it appears between macro bars and meal breakdown in the DOM order

2. **GREEN** — Modify `src/components/daily-dashboard.tsx`:
   - Import `FastingCard` from `@/components/fasting-card`
   - Add `<FastingCard date={selectedDate} />` between the `<MacroBars>` section and the empty state / `<MealBreakdown>` section (around line 256-258)
   - No other changes needed — the fasting card manages its own data fetching

3. **REFACTOR** — Verify dashboard skeleton includes a placeholder for the fasting card position.

**Notes:**
- Insertion point: after `<MacroBars>` (line 248-255) and before the empty state check (line 258)
- The fasting card handles its own loading/error states internally

---

### Task 10: Week date utilities

**Issue:** FOO-341
**Files:**
- `src/lib/date-utils.ts` (modify)
- `src/lib/__tests__/date-utils.test.ts` (modify)

**Dependencies:** None

**TDD Steps:**

1. **RED** — Add tests in `src/lib/__tests__/date-utils.test.ts`:
   - Test `getWeekBounds(dateStr)` returns `{ start, end }` where start is Sunday and end is Saturday
   - Test with a Wednesday → returns preceding Sunday through following Saturday
   - Test with a Sunday → returns that Sunday through following Saturday
   - Test with a Saturday → returns preceding Sunday through that Saturday
   - Test week boundary across month/year boundaries
   - Test `formatWeekRange(start, end)` returns "Feb 9 – 15" (same month) or "Jan 26 – Feb 1" (cross-month)
   - Test `addWeeks(dateStr, n)` adds/subtracts 7*n days

2. **GREEN** — Add functions to `src/lib/date-utils.ts`:
   - `getWeekBounds(dateStr: string): { start: string; end: string }` — compute Sunday (start) and Saturday (end) for the week containing `dateStr`. Use `getDay()` to find day-of-week offset, then `addDays` to compute Sunday and Saturday.
   - `formatWeekRange(start: string, end: string): string` — format as "Mon D – D" (same month) or "Mon D – Mon D" (different months). Use UTC date methods to extract month name and day.
   - `addWeeks(dateStr: string, weeks: number): string` — delegate to `addDays(dateStr, weeks * 7)`

3. **REFACTOR** — Ensure all new functions use UTC consistently (matching existing `addDays` pattern with `T00:00:00Z`).

**Notes:**
- Reference existing `addDays` in `src/lib/date-utils.ts:55-64` for UTC date handling
- Week boundaries: Sunday = 0, Saturday = 6 (JavaScript `getDay()`)

---

### Task 11: Week navigator component

**Issue:** FOO-341
**Files:**
- `src/components/week-navigator.tsx` (create)
- `src/components/__tests__/week-navigator.test.tsx` (create)

**Dependencies:** Task 10

**TDD Steps:**

1. **RED** — Write tests in `src/components/__tests__/week-navigator.test.tsx`:
   - Test renders formatted week range (e.g., "Feb 9 – 15")
   - Test previous button calls `onWeekChange` with week shifted -7 days
   - Test next button calls `onWeekChange` with week shifted +7 days
   - Test next button disabled when current week contains today
   - Test previous button disabled when earliest date is in current week (optional, can omit for simplicity)
   - Test accessibility labels on navigation buttons

2. **GREEN** — Create `src/components/week-navigator.tsx`:
   - Props: `weekStart: string`, `onWeekChange: (newStart: string) => void`
   - Structure: identical layout to `DateNavigator` (left arrow, label, right arrow) but shows week range
   - Use `formatWeekRange` and `addWeeks` from `@/lib/date-utils`
   - Compute `weekEnd` from `addDays(weekStart, 6)`
   - Disable "next" when `weekStart` is the current week (contains today)

3. **REFACTOR** — Match styling exactly to `DateNavigator` for visual consistency.

**Notes:**
- Reference `src/components/date-navigator.tsx` for layout, button styling, and accessibility patterns
- Same `min-h-[44px] min-w-[44px]` touch targets per CLAUDE.md mobile-first requirement

---

### Task 12: Dashboard shell with toggle

**Issue:** FOO-341
**Files:**
- `src/components/dashboard-shell.tsx` (create)
- `src/components/__tests__/dashboard-shell.test.tsx` (create)
- `src/app/app/page.tsx` (modify)

**Dependencies:** Task 9, Task 11

**TDD Steps:**

1. **RED** — Write tests in `src/components/__tests__/dashboard-shell.test.tsx`:
   - Test renders toggle with "Daily" and "Weekly" options
   - Test defaults to "Daily" view (DailyDashboard rendered)
   - Test clicking "Weekly" switches to WeeklyDashboard
   - Test clicking "Daily" switches back to DailyDashboard
   - Test toggle has appropriate styling (selected state visual)

2. **GREEN** — Create `src/components/dashboard-shell.tsx`:
   - `"use client"` component
   - State: `view: "daily" | "weekly"` defaulting to `"daily"`
   - Render a segmented control (two buttons styled as tabs/pills) at the top
   - Conditionally render `<DailyDashboard />` or `<WeeklyDashboard />` based on state
   - `WeeklyDashboard` is a placeholder component for now (renders "Weekly view coming soon" or a skeleton) — it will be assembled in Task 16

3. **GREEN** — Modify `src/app/app/page.tsx`:
   - Replace `<DailyDashboard />` with `<DashboardShell />`
   - Update import from `daily-dashboard` to `dashboard-shell`
   - Keep `<DashboardPrefetch />` below the shell

4. **REFACTOR** — Style the segmented control using Tailwind: rounded-full container, active segment gets `bg-primary text-primary-foreground`, inactive gets `text-muted-foreground`. Minimum 44px height per segment for touch targets.

**Notes:**
- Reference `src/app/app/page.tsx` for current page structure
- Keep `FitbitStatusBanner` and `LumenBanner` OUTSIDE the shell (they're global status, not view-specific)
- `WeeklyDashboard` imported from `@/components/weekly-dashboard` — create a minimal placeholder that will be filled in Task 16

---

### Task 13: Weekly calorie bar chart

**Issue:** FOO-342
**Files:**
- `src/components/weekly-calorie-chart.tsx` (create)
- `src/components/__tests__/weekly-calorie-chart.test.tsx` (create)

**Dependencies:** Task 6 (date range API), Task 2 (calorie goals)

**TDD Steps:**

1. **RED** — Write tests in `src/components/__tests__/weekly-calorie-chart.test.tsx`:
   - Test renders 7 day columns (Sun through Sat labels)
   - Test bar height proportional to calories (tallest day = 100% height)
   - Test bar colored green when under goal, amber when over goal
   - Test goal marker rendered as horizontal line at correct position
   - Test empty column (no data) renders dimmed/empty
   - Test future days render dimmed
   - Test empty state message when zero days have data
   - Test no goal marker when calorieGoal is null

2. **GREEN** — Create `src/components/weekly-calorie-chart.tsx`:
   - Props: `days: DailyNutritionTotals[]`, `weekStart: string`
   - Build a 7-slot array (Sun–Sat) by matching `days` entries to their day-of-week
   - Find max calories across all days for scaling
   - For each slot: render a `div` column with:
     - Day label (S, M, T, W, T, F, S)
     - Bar div with height as percentage of max calories
     - Goal marker: absolutely positioned horizontal line at `(calorieGoal / maxCalories) * 100%`
     - Color: `bg-green-500` if `calories <= calorieGoal`, `bg-amber-500` if over, `bg-primary` if no goal
   - Empty/future days: render with `opacity-30` background
   - Empty state: center text "Log food for a few days to see weekly trends"

3. **REFACTOR** — Extract day-of-week label array as a constant. Ensure responsive sizing.

**Notes:**
- CSS-only chart: `div` containers with percentage heights, flexbox for columns
- Reference `src/components/macro-bars.tsx` for bar styling pattern (progress bars)
- Each column should be equal width (`flex-1`)
- No chart library — pure CSS/div implementation per issue spec

---

### Task 14: Weekly macro averages

**Issue:** FOO-343
**Files:**
- `src/components/weekly-macro-averages.tsx` (create)
- `src/components/__tests__/weekly-macro-averages.test.tsx` (create)

**Dependencies:** Task 6 (date range API)

**TDD Steps:**

1. **RED** — Write tests:
   - Test computes average protein/carbs/fat over days with data only (3 days logged → divide by 3)
   - Test renders averages similar to MacroBars format
   - Test renders "No data" when no days have entries
   - Test rounds to whole numbers
   - Test with single day of data (average = that day's values)

2. **GREEN** — Create `src/components/weekly-macro-averages.tsx`:
   - Props: `days: DailyNutritionTotals[]`
   - Compute: filter out days with zero calories, then average `proteinG`, `carbsG`, `fatG` across remaining days
   - Display: use a layout similar to `MacroBars` but showing "Avg" labels and gram values
   - Three rows: Protein, Carbs, Fat — each showing "avg Xg" with a simple bar
   - Since there's no weekly "goal" for macros (Lumen goals vary daily), bars show relative proportions (same as MacroBars fallback when no goals)

3. **REFACTOR** — Match visual style to `MacroBars` for consistency.

**Notes:**
- Reference `src/components/macro-bars.tsx` for visual design and bar rendering
- Division by logged days only: `days.filter(d => d.calories > 0).length` as denominator

---

### Task 15: Weekly fasting durations

**Issue:** FOO-344
**Files:**
- `src/components/weekly-fasting-chart.tsx` (create)
- `src/components/__tests__/weekly-fasting-chart.test.tsx` (create)

**Dependencies:** Task 7 (fasting API)

**TDD Steps:**

1. **RED** — Write tests:
   - Test renders 7 day slots with fasting duration for each day
   - Test days without fasting data show "—" or empty
   - Test duration formatted as "Xh" or "Xh Ym"
   - Test with partial week (some days with data, some without)
   - Test with no data renders empty state

2. **GREEN** — Create `src/components/weekly-fasting-chart.tsx`:
   - Props: `windows: FastingWindow[]`, `weekStart: string`
   - Build a 7-slot array (Sun–Sat) by matching `windows` entries to their day-of-week by `window.date`
   - Each slot shows the day label and fasting duration
   - Display as a compact row or mini bar chart below the calorie chart
   - Format duration as "Xh" (if exact hour) or "Xh Ym"
   - Empty slots show "—" in muted text

3. **REFACTOR** — Consistent day-of-week label handling with `weekly-calorie-chart.tsx`.

**Notes:**
- Keep this component simple — a row of 7 cells showing durations
- Reference `weekly-calorie-chart.tsx` (Task 13) for the 7-slot layout pattern
- The fasting data comes from the parent `WeeklyDashboard` which fetches `/api/fasting?from=...&to=...`

---

### Task 16: Weekly dashboard assembly

**Issue:** FOO-341, FOO-342, FOO-343, FOO-344
**Files:**
- `src/components/weekly-dashboard.tsx` (create or modify placeholder from Task 12)
- `src/components/__tests__/weekly-dashboard.test.tsx` (create)

**Dependencies:** Task 11, Task 13, Task 14, Task 15

**TDD Steps:**

1. **RED** — Write tests in `src/components/__tests__/weekly-dashboard.test.tsx`:
   - Test renders `WeekNavigator` component
   - Test renders `WeeklyCalorieChart` with data from SWR
   - Test renders `WeeklyMacroAverages` with data from SWR
   - Test renders `WeeklyFastingChart` with data from SWR
   - Test loading state shows skeleton placeholders
   - Test error state shows error message
   - Test week navigation updates SWR fetch URLs
   - Mock SWR responses for nutrition and fasting data

2. **GREEN** — Implement `src/components/weekly-dashboard.tsx`:
   - `"use client"` component
   - State: `weekStart` initialized to current week's Sunday via `getWeekBounds(getTodayDate()).start`
   - Compute `weekEnd` from `addDays(weekStart, 6)`
   - SWR fetches:
     - `useSWR<DateRangeNutritionResponse>(`/api/nutrition-summary?from=${weekStart}&to=${weekEnd}`, apiFetcher)`
     - `useSWR<{ windows: FastingWindow[] }>(`/api/fasting?from=${weekStart}&to=${weekEnd}`, apiFetcher)`
   - Render in order:
     1. `<WeekNavigator weekStart={weekStart} onWeekChange={setWeekStart} />`
     2. `<WeeklyCalorieChart days={nutritionData?.days ?? []} weekStart={weekStart} />`
     3. `<WeeklyMacroAverages days={nutritionData?.days ?? []} />`
     4. `<WeeklyFastingChart windows={fastingData?.windows ?? []} weekStart={weekStart} />`
   - Loading state: skeleton placeholders matching the layout
   - Error state: error message (follow daily dashboard error pattern)

3. **REFACTOR** — Add a `WeeklyDashboardSkeleton` function (follow `DashboardSkeleton` pattern in `src/components/daily-dashboard.tsx:17-46`).

**Notes:**
- Reference `src/components/daily-dashboard.tsx` for the overall dashboard pattern (SWR fetches, loading, error states)
- Two SWR calls: one for nutrition data (includes calorie goals), one for fasting data
- `apiFetcher` from `@/lib/swr`

---

### Task 17: Integration & Verification

**Issue:** FOO-336, FOO-337, FOO-338, FOO-339, FOO-340, FOO-341, FOO-342, FOO-343, FOO-344
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Verify zero warnings policy
6. Manual verification checklist:
   - [ ] Daily dashboard shows fasting card with duration
   - [ ] Fasting card shows live counter before first meal of the day
   - [ ] Toggle switches between Daily and Weekly views
   - [ ] Weekly calorie chart shows 7 bars with goal markers
   - [ ] Weekly macro averages display below chart
   - [ ] Weekly fasting durations display for each day
   - [ ] Week navigation shifts by 7 days
   - [ ] Date range API returns correct data for a week

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |
| Linear | `create_comment` | Add progress notes to issues if needed |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Fasting API: no previous day data | Return null fasting window | Unit test (Task 7) |
| Fasting API: invalid date param | Return 400 VALIDATION_ERROR | Unit test (Task 7) |
| Date range API: from > to | Return 400 VALIDATION_ERROR | Unit test (Task 6) |
| Date range API: DB query fails | Return 500 INTERNAL_ERROR | Unit test (Task 6) |
| Calorie goal upsert fails | Log warning, return response normally | Unit test (Task 3) |
| Weekly dashboard: SWR fetch fails | Show error message | Unit test (Task 16) |
| Weekly dashboard: no data for week | Show empty state in charts | Unit test (Tasks 13-15) |

## Risks & Open Questions

- [ ] **Fasting duration edge case:** If someone logs a meal at 1 AM (assigned to Monday) and first eats at 6 AM Tuesday, the fasting duration computes as 29 hours. This is accepted per the issue spec ("no arbitrary hour cap").
- [ ] **Calorie goal backfill:** Historical goals won't exist until the user visits the app and triggers a `/api/nutrition-goals` fetch. Past weeks will show no goal markers. Accepted — goals accumulate over time.
- [ ] **Week boundary convention:** Using Sunday–Saturday per the issue spec. If the user prefers Monday–Sunday, this is a future enhancement.

## Scope Boundaries

**In Scope:**
- Fasting window calculation, card display, and live counter
- Date range nutrition summary API
- Historical calorie goal storage and capture
- Daily/Weekly dashboard toggle
- Weekly calorie chart, macro averages, and fasting durations

**Out of Scope:**
- Service worker / offline support
- Custom week start day configuration
- Macro goals for weekly averages (Lumen goals vary daily)
- Fasting goal setting or reminders
- Recharts or other chart library integration
