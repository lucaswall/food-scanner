# Fix Plan: Budget Marker Not Visible + Missing Error UX

**Issues:** FOO-313, FOO-314, FOO-315
**Date:** 2026-02-10
**Status:** Planning
**Branch:** fix/FOO-313-budget-marker-scope-and-errors

## Investigation

### Bug Report
The calorie budget marker added in FOO-309 is not visible on staging or production. Additionally, no error is shown to the user when the underlying API call fails.

### Classification
- **Type:** Integration + Frontend Bug
- **Severity:** High (FOO-313), Medium (FOO-314, FOO-315)
- **Affected Area:** Fitbit OAuth, CalorieRing component, DailyDashboard component

### Root Cause Analysis

**Three issues found:**

1. **FOO-313 — Missing OAuth scope:** `buildFitbitAuthUrl` at `src/lib/fitbit.ts:308` only requests `scope: "nutrition"`. The activity summary endpoint requires the `activity` scope. Every call to `/api/activity-summary` fails with Fitbit 403 PERMISSION_DENIED.

2. **FOO-314 — Double rotation offset:** The marker angle at `src/components/calorie-ring.tsx:70` applies `-Math.PI / 2` to shift from 3-o'clock to 12-o'clock, but the SVG parent already has `className="transform -rotate-90"` (line 38). The double correction positions the marker 90° CCW from where it should be. This was invisible because FOO-313 prevented any marker from rendering.

3. **FOO-315 — Silent failure, no user feedback:** The activity SWR call in `src/components/daily-dashboard.tsx:58-60` doesn't destructure `error`. When the API returns 502 (mapped from Fitbit 403), `activity` is `undefined`, `budget` stays `undefined`, and the marker silently doesn't render. No indication is given to the user. Additionally, `fetchWithRetry` at `src/lib/fitbit.ts:84` handles 401 and 429 but not 403 — all 403s fall through as generic `FITBIT_API_ERROR`.

#### Evidence
- **Railway logs (staging + production):** Every activity summary call returns 403 with `"The caller does not have permission"`
- **`src/lib/fitbit.ts:308`** — `scope: "nutrition"` (missing `activity`)
- **`src/components/calorie-ring.tsx:70`** — `budgetPosition * 2 * Math.PI - Math.PI / 2` (double rotation)
- **`src/components/daily-dashboard.tsx:58-60`** — no error handling on activity SWR
- **`src/lib/fitbit.ts:84-86`** — 401 handled, 403 not handled
- **`src/types/index.ts:106-119`** — no `FITBIT_SCOPE_MISSING` error code

### Impact
- Budget marker feature (FOO-309) is completely non-functional
- User has no indication anything is wrong
- Re-authorization via Settings is available but user doesn't know they need it

## Fix Plan (TDD Approach)

### Step 1: Add `activity` scope to Fitbit OAuth (FOO-313)
**File:** `src/lib/fitbit.ts` (modify)
**Test:** `src/lib/__tests__/fitbit.test.ts` (modify)

**Behavior:**
- `buildFitbitAuthUrl` should include both `nutrition` and `activity` in the `scope` parameter (space-separated per Fitbit OAuth spec)
- The generated URL's `scope` query param must contain both values

**Tests:**
1. Existing test at ~line 83 "requests nutrition scope" — update to verify both `nutrition` and `activity` are present in the scope param
2. Add test: scope param contains `activity`

### Step 2: Fix budget marker angle (FOO-314)
**File:** `src/components/calorie-ring.tsx` (modify)
**Test:** `src/components/__tests__/calorie-ring.test.tsx` (modify)

**Behavior:**
- The marker angle should be `budgetPosition * 2 * Math.PI` (no `-Math.PI / 2` offset)
- Since the SVG has `className="transform -rotate-90"`, the CSS rotation handles the 12-o'clock start; the marker coordinates should use raw SVG angles (0 = 3 o'clock in SVG, which becomes 12 o'clock after CSS rotation)
- At budgetPosition=0.5 (50% of goal): marker should be at SVG angle π (9 o'clock in SVG → 6 o'clock on screen after rotation)

**Tests:**
1. Update existing "positions marker at start when budget is 0" test — the marker line coordinates should map to SVG 3-o'clock (rightmost point), which after CSS -rotate-90 appears at 12 o'clock. Verify: x1/x2 are at max radius, y1/y2 are at center.
2. Update "caps marker at goal position when budget exceeds goal" — budget at 100% should also be at SVG 3-o'clock (full circle returns to start)
3. Add test: budget at 50% of goal → marker at SVG 9-o'clock (x at min, y at center)

### Step 3: Add `FITBIT_SCOPE_MISSING` error code and handle 403 (FOO-315)
**File:** `src/types/index.ts` (modify)
**File:** `src/lib/fitbit.ts` (modify)
**Test:** `src/lib/__tests__/fitbit.test.ts` (modify)

**Behavior:**
- Add `"FITBIT_SCOPE_MISSING"` to the `ErrorCode` union type
- In `fetchWithRetry`, add a 403 handler between the existing 401 and 429 handlers. When `response.status === 403`, throw `new Error("FITBIT_SCOPE_MISSING")`
- This applies to all Fitbit API calls that go through `fetchWithRetry` — a 403 from Fitbit means the token lacks required scopes

**Tests:**
1. Add test in `fetchWithRetry` section: 403 response throws `FITBIT_SCOPE_MISSING`
2. Add test in `getActivitySummary` section: 403 response (via fetchWithRetry) throws `FITBIT_SCOPE_MISSING`

### Step 4: Map `FITBIT_SCOPE_MISSING` in activity-summary route (FOO-315)
**File:** `src/app/api/activity-summary/route.ts` (modify)
**Test:** `src/app/api/activity-summary/__tests__/route.test.ts` (modify)

**Behavior:**
- Add a new error handler for `FITBIT_SCOPE_MISSING` in the catch block, alongside the existing `FITBIT_CREDENTIALS_MISSING` and `FITBIT_TOKEN_INVALID` handlers
- Return `errorResponse("FITBIT_SCOPE_MISSING", "Fitbit permissions need updating. Please reconnect your Fitbit account in Settings.", 403)`
- Follow the same pattern as `src/app/api/nutrition-goals/route.ts` error handling

**Tests:**
1. Add test: when `getActivitySummary` throws `FITBIT_SCOPE_MISSING`, returns 403 with `FITBIT_SCOPE_MISSING` code and descriptive message

### Step 5: Surface activity errors in dashboard (FOO-315)
**File:** `src/components/daily-dashboard.tsx` (modify)
**Test:** `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**Behavior:**
- Destructure `error: activityError` from the activity SWR call
- When `activityError` is truthy and the ring is being rendered (goals.calories exists), show a small non-intrusive message below the calorie ring
- The message should say something like "Fitbit permissions need updating" with a link to `/settings`
- The rest of the dashboard (calorie ring without marker, macro bars, meal breakdown) must still render normally — only the budget marker is affected
- The message should use `text-sm text-muted-foreground` styling and include a `Link` to `/settings` with primary color
- Touch target for the link must be at least 44px tall (wrap in a min-h-[44px] flex container)

**Tests:**
1. Add test: when activity SWR returns error, shows reconnect message with link to settings
2. Add test: when activity SWR returns error, CalorieRing still renders (without budget prop)
3. Add test: when activity SWR returns error, MacroBars and MealBreakdown still render
4. Existing test "passes budget prop when activity data is available" should still pass

### Step 6: Verify
- [ ] All new tests pass
- [ ] All existing tests pass
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

## Notes
- After deploying the scope fix, the user must re-authorize Fitbit via Settings > Reconnect Fitbit on both staging and production
- The `fetchWithRetry` 403 handler applies to ALL Fitbit API calls — this is intentional since Fitbit 403 universally means insufficient scope
- The nutrition-summary and nutrition-goals routes don't need the scope fix since they only use the `nutrition` scope which is already granted
- No database migration needed

---

## Iteration 1

**Implemented:** 2026-02-10
**Method:** Agent team (3 workers)

### Tasks Completed This Iteration
- Step 1: Add `activity` scope to Fitbit OAuth (FOO-313) — worker-1
- Step 2: Fix budget marker angle (FOO-314) — worker-2
- Step 3: Add `FITBIT_SCOPE_MISSING` error code and handle 403 (FOO-315) — worker-1
- Step 4: Map `FITBIT_SCOPE_MISSING` in activity-summary route (FOO-315) — worker-3
- Step 5: Surface activity errors in dashboard (FOO-315) — worker-3

### Files Modified
- `src/types/index.ts` — Added `FITBIT_SCOPE_MISSING` to ErrorCode union
- `src/lib/fitbit.ts` — Changed scope to `"nutrition activity"`, added 403 handler in fetchWithRetry
- `src/lib/__tests__/fitbit.test.ts` — Updated scope tests, added 403 handling tests
- `src/components/calorie-ring.tsx` — Removed redundant `-Math.PI / 2` from angle calculation
- `src/components/__tests__/calorie-ring.test.tsx` — Updated marker position tests, added 50% position test
- `src/app/api/activity-summary/route.ts` — Added FITBIT_SCOPE_MISSING error handler (403)
- `src/app/api/activity-summary/__tests__/route.test.ts` — Added scope missing error test
- `src/components/daily-dashboard.tsx` — Added activity error display with reconnect link
- `src/components/__tests__/daily-dashboard.test.tsx` — Added 3 error UX tests

### Linear Updates
- FOO-313: Todo → In Progress → Review
- FOO-314: Todo → In Progress → Review
- FOO-315: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 HIGH (accepted per plan design), 2 MEDIUM (minor), 1 LOW
- verifier: All 1195 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Steps 1, 3 (fitbit backend files + types)
- Worker 2: Step 2 (calorie-ring component)
- Worker 3: Steps 4, 5 (activity-summary route + dashboard error UX)

### Continuation Status
All tasks completed.
