# Fix Plan: Lumen Goals Date Mismatch Between Client and Server Timezone

**Issue:** [FOO-324](https://linear.app/lw-claude/issue/FOO-324/fix-lumen-goals-date-mismatch-between-client-and-server-timezone)
**Date:** 2026-02-11
**Status:** Planning
**Branch:** fix/FOO-324-lumen-date-timezone

## Investigation

### Bug Report
Lumen screenshot upload appears to fail on staging. After uploading a screenshot, the banner stays visible and the dashboard doesn't show the parsed macro goals.

### Classification
- **Type:** Data Issue
- **Severity:** High
- **Affected Area:** Lumen goals upload flow (LumenBanner, DailyDashboard, lumen-goals API route)

### Root Cause Analysis

**Timezone mismatch between client-side and server-side `getTodayDate()` functions.**

When the user's local timezone is behind UTC, the client and server disagree on what "today" is. Goals get saved under the UTC date but queried by the local date, causing a permanent miss.

#### Evidence

**Staging logs** (deployment `8f6aed1f`, 2026-02-11T00:13:12Z):

POST saves goals with **server UTC date** `2026-02-11`:
```
[INFO] Lumen goals parsed and saved  date="2026-02-11" dayType="Low Carb"
[INFO] Lumen goals upserted          date="2026-02-11" dayType="Low Carb"
```

GET queries use **client local date** `2026-02-10` and always finds nothing:
```
[INFO] lumen goals retrieved  date="2026-02-10" hasGoals=false
[INFO] lumen goals retrieved  date="2026-02-10" hasGoals=false
```

#### Related Code

- `src/components/lumen-banner.tsx:10-16` — client-side `getTodayDate()` using `new Date()` in local timezone, used for SWR GET key at line 25
- `src/components/lumen-banner.tsx:47-48` — POST FormData only appends `image`, does NOT include `date`
- `src/components/daily-dashboard.tsx:15-21` — duplicate client-side `getTodayDate()`, used for SWR GET key at line 72
- `src/components/daily-dashboard.tsx:86-87` — POST FormData only appends `image`, does NOT include `date`
- `src/app/api/lumen-goals/route.ts:19-25` — server-side `getTodayDate()` using `new Date()` in UTC (Railway)
- `src/app/api/lumen-goals/route.ts:129` — when `dateRaw === null`, defaults to server UTC today

### Impact
- Upload succeeds server-side but appears to fail client-side
- Banner stays visible indefinitely (it checks client date, goals stored under server date)
- Macro goals never show on dashboard for the same reason
- Affects any user whose local timezone differs from UTC, especially when the dates cross midnight differently

## Fix Plan (TDD Approach)

### Step 1: Add date to LumenBanner POST request
**File:** `src/components/lumen-banner.tsx` (modify)
**Test:** `src/components/__tests__/lumen-banner.test.tsx` (modify)

**Behavior:**
- The `handleFileChange` function should append a `date` field to FormData alongside the image
- The date value should be `today` (already computed at line 19 from client-side `getTodayDate()`)
- This ensures the server saves goals under the same date the SWR GET queries

**Tests:**
1. When a file is selected and upload succeeds, the POST fetch body (FormData) includes a `date` field matching the client-side today date
2. All existing LumenBanner tests continue to pass

### Step 2: Add date to DailyDashboard Lumen update POST request
**File:** `src/components/daily-dashboard.tsx` (modify)
**Test:** `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**Behavior:**
- The `handleLumenFileChange` function should append a `date` field to FormData alongside the image
- The date value should be `today` (already computed at line 48 from client-side `getTodayDate()`)
- Same fix as Step 1, applied to the "Update Lumen goals" button flow

**Tests:**
1. When updating Lumen goals via the update button, the POST fetch body (FormData) includes a `date` field matching the client-side today date
2. All existing DailyDashboard tests continue to pass

### Step 3: Verify
- [ ] All new tests pass
- [ ] All existing tests pass
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Build succeeds

## Notes
- The server-side `getTodayDate()` in `route.ts:19-25` is still used as a fallback when no date is provided in the POST body. This is fine — the fix ensures clients always send their local date, so the fallback is only hit by direct API calls without a date.
- The `getTodayDate()` duplication across 3 files (noted in the review as LOW convention issue) is acceptable since the client and server versions intentionally use different timezones. The key invariant is: **the date used in GET queries must match the date sent in POST requests**, which means both must come from the client.

---

## Status: Planning
