# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-229-performance-and-loading-improvements
**Issues:** FOO-229, FOO-230, FOO-231, FOO-232, FOO-233, FOO-234
**Created:** 2026-02-08
**Last Updated:** 2026-02-08

## Summary

Comprehensive performance and UX improvement batch: add loading skeletons to all app routes, set Cache-Control headers on cacheable GET API routes, migrate FoodHistory and QuickSelect to SWR for client-side caching, add optimistic UI updates to food logging, prefetch API data from the dashboard, and document performance conventions in CLAUDE.md.

## Issues

### FOO-229: Add loading.tsx skeletons to all app routes

**Priority:** Medium
**Labels:** Improvement
**Description:** No `loading.tsx` files exist. Users see blank screens during navigation while server components render on Railway US (~200-300ms from Argentina). Create `loading.tsx` in all 5 app routes with skeleton UI matching each page's layout.

**Acceptance Criteria:**
- [ ] `loading.tsx` exists in `src/app/app/`, `src/app/app/analyze/`, `src/app/app/history/`, `src/app/app/quick-select/`, `src/app/settings/`
- [ ] Each skeleton mirrors the corresponding page's layout with placeholder shimmer boxes
- [ ] Uses shadcn/ui `Skeleton` component for consistency
- [ ] Zero build warnings

### FOO-230: Add Cache-Control headers to cacheable GET API routes

**Priority:** Medium
**Labels:** Performance
**Description:** GET API routes (`/api/common-foods`, `/api/food-history`) return no Cache-Control headers. Every request makes a full round trip to Railway US. Setting appropriate private cache headers lets the browser serve stale responses instantly while revalidating.

**Acceptance Criteria:**
- [ ] `GET /api/common-foods` returns `Cache-Control: private, max-age=60, stale-while-revalidate=300`
- [ ] `GET /api/food-history` returns `Cache-Control: private, max-age=30, stale-while-revalidate=120`
- [ ] `GET /api/auth/session` returns `Cache-Control: private, no-cache`
- [ ] Headers are set on the Response object returned from each route handler
- [ ] Existing tests still pass

### FOO-231: Add SWR-style client caching to FoodHistory and QuickSelect

**Priority:** Medium
**Labels:** Performance
**Description:** FoodHistory and QuickSelect fetch data fresh on every mount via `useState` + `fetch()`. SWR is already installed (`swr@^2.4.0`) and used in `SettingsContent`. Migrate these two components to use `useSWR` for instant cached rendering with background revalidation.

**Acceptance Criteria:**
- [ ] FoodHistory uses `useSWR` for initial data fetch (first page)
- [ ] QuickSelect uses `useSWR` for `/api/common-foods` fetch
- [ ] Stale data renders instantly on navigation; revalidation happens in background
- [ ] Cache is invalidated after food log or delete operations
- [ ] Cursor-based pagination ("Load More") continues to work in FoodHistory
- [ ] Pending submission recovery flow still works in QuickSelect

### FOO-232: Add optimistic UI updates to food logging

**Priority:** Low
**Labels:** Improvement
**Description:** Food logging shows a spinner for 1-2s during the API round-trip. Show instant success feedback and sync in background. On failure, revert and show error toast.

**Acceptance Criteria:**
- [ ] After tapping "Log to Fitbit", UI immediately shows success state
- [ ] API call fires in background
- [ ] On success: update with real IDs from server response
- [ ] On failure: revert optimistic update, show error, store in pending-submissions for retry
- [ ] Fitbit token expiration flow still works (redirect to auth)

### FOO-233: Prefetch API data for likely next navigations

**Priority:** Low
**Labels:** Performance
**Description:** Dashboard is the main hub. Users navigate to analyze, history, or quick-select next. Prefetch `/api/common-foods` and first page of `/api/food-history` in background on dashboard mount so these pages render instantly.

**Acceptance Criteria:**
- [ ] Dashboard mounts trigger background prefetch of `/api/common-foods` and `/api/food-history`
- [ ] Uses SWR `preload()` to warm the cache (depends on FOO-231 SWR adoption)
- [ ] Prefetch only fires after visible content has loaded (non-blocking)
- [ ] No visible UI change on dashboard

### FOO-234: Update CLAUDE.md with performance conventions

**Priority:** Low
**Labels:** Convention
**Description:** After implementing the performance improvements, document the conventions in CLAUDE.md so future development follows the same patterns.

**Acceptance Criteria:**
- [ ] CLAUDE.md has a PERFORMANCE section (5-8 lines max)
- [ ] Documents: loading.tsx requirement, Cache-Control header convention, SWR usage pattern
- [ ] Follows "only deviations from defaults" principle

## Prerequisites

- [ ] shadcn/ui Skeleton component must be installed: `npx shadcn@latest add skeleton`
- [ ] SWR is already installed (`swr@^2.4.0` in package.json) — no install needed

## Implementation Tasks

### Task 1: Install shadcn/ui Skeleton component

**Issue:** FOO-229
**Files:**
- `src/components/ui/skeleton.tsx` (create — generated by shadcn CLI)

**Steps:**

1. Run: `npx shadcn@latest add skeleton`
2. Verify `src/components/ui/skeleton.tsx` is created
3. Run: `npm run typecheck`

**Notes:**
- This is a prerequisite for Task 2. Must be done before writing loading.tsx files.

---

### Task 2: Add loading.tsx to dashboard route

**Issue:** FOO-229
**Files:**
- `src/app/app/loading.tsx` (create)
- `src/app/app/__tests__/loading.test.tsx` (create)

**TDD Steps:**

1. **RED** - Write failing test:
   - Create `src/app/app/__tests__/loading.test.tsx`
   - Test that the loading component renders a heading skeleton and two card skeletons matching the dashboard layout (h1 "Food Scanner" placeholder + 2-column grid of card placeholders + dashboard preview placeholder)
   - Run: `npm test -- src/app/app/__tests__/loading.test.tsx`
   - Verify: Test fails (module not found)

2. **GREEN** - Make it pass:
   - Create `src/app/app/loading.tsx` (NOT a client component — loading.tsx should be a plain React component)
   - Render skeleton matching dashboard layout:
     - `Skeleton` for h1 area (~w-40 h-8)
     - 2-column grid with two `Skeleton` cards (~h-24 each)
     - `Skeleton` for DashboardPreview area (~h-64)
   - Use same container: `min-h-screen px-4 py-6` > `mx-auto w-full max-w-md flex flex-col gap-6`
   - Run: `npm test -- src/app/app/__tests__/loading.test.tsx`
   - Verify: Test passes

**Reference:** Dashboard page layout at `src/app/app/page.tsx`

---

### Task 3: Add loading.tsx to analyze route

**Issue:** FOO-229
**Files:**
- `src/app/app/analyze/loading.tsx` (create)
- `src/app/app/analyze/__tests__/loading.test.tsx` (create)

**TDD Steps:**

1. **RED** - Write failing test:
   - Create `src/app/app/analyze/__tests__/loading.test.tsx`
   - Test that loading component renders heading skeleton + photo capture area skeleton + button skeleton
   - Run: `npm test -- src/app/app/analyze/__tests__/loading.test.tsx`
   - Verify: Test fails

2. **GREEN** - Make it pass:
   - Create `src/app/app/analyze/loading.tsx`
   - Render skeleton matching analyze layout:
     - `Skeleton` for h1 "Analyze Food" (~w-36 h-8)
     - `Skeleton` for photo capture area (~h-48 rounded-xl)
     - `Skeleton` for description input (~h-10)
     - `Skeleton` for analyze button (~h-11 w-full)
   - Same container pattern as Task 2
   - Run: `npm test -- src/app/app/analyze/__tests__/loading.test.tsx`

**Reference:** Analyze page at `src/app/app/analyze/page.tsx`, FoodAnalyzer at `src/components/food-analyzer.tsx`

---

### Task 4: Add loading.tsx to history route

**Issue:** FOO-229
**Files:**
- `src/app/app/history/loading.tsx` (create)
- `src/app/app/history/__tests__/loading.test.tsx` (create)

**TDD Steps:**

1. **RED** - Write failing test:
   - Create `src/app/app/history/__tests__/loading.test.tsx`
   - Test that loading component renders heading skeleton + date picker skeleton + 3 entry skeletons
   - Run: `npm test -- src/app/app/history/__tests__/loading.test.tsx`

2. **GREEN** - Make it pass:
   - Create `src/app/app/history/loading.tsx`
   - Render skeleton matching history layout:
     - `Skeleton` for h1 "History" (~w-24 h-8)
     - `Skeleton` for date picker row (~h-11 flex with gap)
     - 3x `Skeleton` for food entry cards (~h-16 each, matching FoodHistory's loading state)
   - Same container pattern
   - Run: `npm test -- src/app/app/history/__tests__/loading.test.tsx`

**Reference:** History page at `src/app/app/history/page.tsx`, FoodHistory loading state at `src/components/food-history.tsx:165-175`

---

### Task 5: Add loading.tsx to quick-select route

**Issue:** FOO-229
**Files:**
- `src/app/app/quick-select/loading.tsx` (create)
- `src/app/app/quick-select/__tests__/loading.test.tsx` (create)

**TDD Steps:**

1. **RED** - Write failing test:
   - Create `src/app/app/quick-select/__tests__/loading.test.tsx`
   - Test that loading component renders heading skeleton + 3 food card skeletons
   - Run: `npm test -- src/app/app/quick-select/__tests__/loading.test.tsx`

2. **GREEN** - Make it pass:
   - Create `src/app/app/quick-select/loading.tsx`
   - Render skeleton matching quick-select layout:
     - `Skeleton` for h1 "Quick Select" (~w-32 h-8)
     - 3x `Skeleton` for food cards (~h-20 each, matching QuickSelect's loading state)
   - Same container pattern
   - Run: `npm test -- src/app/app/quick-select/__tests__/loading.test.tsx`

**Reference:** QuickSelect loading state at `src/components/quick-select.tsx:247-257`

---

### Task 6: Add loading.tsx to settings route

**Issue:** FOO-229
**Files:**
- `src/app/settings/loading.tsx` (create)
- `src/app/settings/__tests__/loading.test.tsx` (create)

**TDD Steps:**

1. **RED** - Write failing test:
   - Create `src/app/settings/__tests__/loading.test.tsx`
   - Test that loading component renders back button skeleton + heading skeleton + settings card skeleton
   - Run: `npm test -- src/app/settings/__tests__/loading.test.tsx`

2. **GREEN** - Make it pass:
   - Create `src/app/settings/loading.tsx`
   - Render skeleton matching settings layout:
     - Flex row with `Skeleton` for back button (~w-11 h-11) + heading (~w-24 h-8)
     - `Skeleton` for settings card (~h-48 rounded-xl)
     - `Skeleton` for appearance card (~h-32 rounded-xl)
   - Same centering as SettingsContent: `flex min-h-screen items-center justify-center px-4` > `w-full max-w-sm flex flex-col gap-6`
   - Run: `npm test -- src/app/settings/__tests__/loading.test.tsx`

**Reference:** Settings page at `src/app/settings/page.tsx`, SettingsContent at `src/components/settings-content.tsx`

---

### Task 7: Add Cache-Control headers to GET /api/common-foods

**Issue:** FOO-230
**Files:**
- `src/app/api/common-foods/route.ts` (modify)
- `src/app/api/common-foods/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing test:
   - Add test to existing `src/app/api/common-foods/__tests__/route.test.ts`:
     ```
     it("sets Cache-Control header for private caching", async () => {
       // Setup mock session + foods
       const response = await GET();
       expect(response.headers.get("Cache-Control")).toBe("private, max-age=60, stale-while-revalidate=300");
     });
     ```
   - Run: `npm test -- src/app/api/common-foods/__tests__/route.test.ts`
   - Verify: Test fails (Cache-Control is null)

2. **GREEN** - Make it pass:
   - In `src/app/api/common-foods/route.ts`, modify the success response to include Cache-Control header.
   - The `successResponse` helper returns `Response.json()`. To add headers, create the response and set the header:
     ```typescript
     const response = successResponse({ foods });
     response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
     return response;
     ```
   - Run: `npm test -- src/app/api/common-foods/__tests__/route.test.ts`

**Notes:**
- `private` because response is user-specific (session-authenticated)
- 60s max-age: common foods change slowly (based on time of day + last 30 days history)
- 300s stale-while-revalidate: OK to show slightly stale data while refreshing

---

### Task 8: Add Cache-Control headers to GET /api/food-history

**Issue:** FOO-230
**Files:**
- `src/app/api/food-history/route.ts` (modify)
- `src/app/api/food-history/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing test:
   - Add test to existing `src/app/api/food-history/__tests__/route.test.ts`:
     ```
     it("sets Cache-Control header for private caching", async () => {
       const response = await GET(new Request("http://localhost/api/food-history"));
       expect(response.headers.get("Cache-Control")).toBe("private, max-age=30, stale-while-revalidate=120");
     });
     ```
   - Run: `npm test -- src/app/api/food-history/__tests__/route.test.ts`

2. **GREEN** - Make it pass:
   - Same pattern as Task 7:
     ```typescript
     const response = successResponse({ entries });
     response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
     return response;
     ```
   - Run: `npm test -- src/app/api/food-history/__tests__/route.test.ts`

**Notes:**
- 30s max-age: food history changes when user logs/deletes food
- 120s stale-while-revalidate: OK for background refresh

---

### Task 9: Add Cache-Control: no-cache to GET /api/auth/session

**Issue:** FOO-230
**Files:**
- `src/app/api/auth/session/route.ts` (modify)
- `src/app/api/auth/session/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing test:
   - Add test: session response should have `Cache-Control: private, no-cache`
   - Run: `npm test -- src/app/api/auth/session/__tests__/route.test.ts`

2. **GREEN** - Make it pass:
   - Add `response.headers.set("Cache-Control", "private, no-cache")` before returning
   - Run: `npm test -- src/app/api/auth/session/__tests__/route.test.ts`

**Notes:**
- Session data must always be fresh — `no-cache` forces revalidation on every request

---

### Task 10: Migrate QuickSelect to useSWR

**Issue:** FOO-231
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Update existing tests:
   - Tests currently mock `global.fetch`. SWR wraps fetch, so existing mocks should still work.
   - Add a new test: "shows cached data instantly on re-mount" — mount component, wait for data, unmount, re-mount, verify data appears without loading state.
   - Run: `npm test -- src/components/__tests__/quick-select.test.tsx`

2. **GREEN** - Migrate to useSWR:
   - Replace the `fetchFoods` callback + `useEffect` pattern with:
     ```typescript
     const { data, isLoading, mutate } = useSWR<{ foods: CommonFood[] }>(
       "/api/common-foods",
       async (url: string) => {
         const response = await fetch(url);
         const result = await response.json();
         if (!result.success) throw new Error("Failed to load");
         return result.data;
       },
       { revalidateOnFocus: false }
     );
     const foods = data?.foods ?? [];
     const loadingFoods = isLoading;
     ```
   - After successful food log, call `mutate()` to invalidate cache
   - Keep pending submission recovery flow unchanged (it runs in `useEffect`, separate from SWR)
   - Run: `npm test -- src/components/__tests__/quick-select.test.tsx`

3. **REFACTOR**:
   - Remove now-unused `fetchFoods` callback and its `useEffect`
   - Replace manual `setLoadingFoods` with SWR's `isLoading`
   - Remove `setFoods` state — use SWR's `data` directly

**Reference:** SWR pattern in `src/components/settings-content.tsx:7-34`

**Notes:**
- Keep `revalidateOnFocus: false` since common foods don't change frequently
- The `onDone` callback in `FoodLogConfirmation` currently calls `fetchFoods()` — replace with `mutate()`

---

### Task 11: Migrate FoodHistory to useSWR (first page only)

**Issue:** FOO-231
**Files:**
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Update tests:
   - Add test: "shows cached data instantly on re-mount"
   - Existing fetch mocks should continue to work
   - Run: `npm test -- src/components/__tests__/food-history.test.tsx`

2. **GREEN** - Migrate initial fetch to useSWR:
   - Use SWR for the initial page load only:
     ```typescript
     const { data: initialData, isLoading, mutate } = useSWR<{ entries: FoodLogHistoryEntry[] }>(
       "/api/food-history?limit=20",
       async (url: string) => {
         const response = await fetch(url);
         const result = await response.json();
         if (!result.success) throw new Error("Failed to load");
         return result.data;
       },
       { revalidateOnFocus: false }
     );
     ```
   - Keep `entries` in local state for append-based pagination. Seed from `initialData` via `useEffect`:
     ```typescript
     useEffect(() => {
       if (initialData?.entries) {
         setEntries(initialData.entries);
         setHasMore(initialData.entries.length >= 20);
       }
     }, [initialData]);
     ```
   - "Load More" continues to use manual fetch + append to local state
   - After delete, call `mutate()` to refresh the cache
   - Run: `npm test -- src/components/__tests__/food-history.test.tsx`

3. **REFACTOR**:
   - Remove the initial `useEffect(() => { fetchEntries(); }, [])` call
   - Keep `fetchEntries` for pagination (Load More) and Jump to Date
   - Use SWR's `isLoading` for initial loading state

**Notes:**
- FoodHistory has cursor-based pagination which doesn't map well to SWR's key-based caching. Only the first page uses SWR; subsequent pages use manual fetch.
- Jump to Date resets local state and calls `fetchEntries` directly (bypasses SWR) since it's a different query.

---

### Task 12: Add optimistic UI to QuickSelect food logging

**Issue:** FOO-232
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Write failing test:
   - Add test: "shows success immediately after tapping Log to Fitbit"
   - Mock fetch to delay response (simulate network latency)
   - Verify: FoodLogConfirmation renders immediately, before fetch resolves
   - Run: `npm test -- src/components/__tests__/quick-select.test.tsx`

2. **GREEN** - Implement optimistic update:
   - In `handleLogToFitbit`, immediately set `logResponse` with a provisional response:
     ```typescript
     // Optimistic: show success immediately
     const optimisticResponse: FoodLogResponse = {
       fitbitLogId: 0,   // placeholder
       foodLogId: 0,     // placeholder
       foodName: selectedFood.foodName,
       calories: selectedFood.calories,
     };
     setLogResponse(optimisticResponse);
     ```
   - Fire the API call in background:
     ```typescript
     try {
       const response = await fetch("/api/log-food", { ... });
       const result = await response.json();
       if (!response.ok || !result.success) {
         // Revert optimistic update
         setLogResponse(null);
         // Handle error (token invalid → redirect, else show error)
         ...
       } else {
         // Update with real response
         setLogResponse(result.data);
       }
     } catch {
       setLogResponse(null);
       setLogError("Failed to log food");
     }
     ```
   - Note: Fitbit token expiration check must still redirect — don't show optimistic success if we know the token is expired (but we can't know until the API responds, so the revert handles this)
   - Run: `npm test -- src/components/__tests__/quick-select.test.tsx`

**Notes:**
- Keep the existing `logging` state for the brief moment between tap and optimistic display
- FoodLogConfirmation component must handle `fitbitLogId: 0` gracefully (it likely doesn't display IDs, so this should be fine)
- After revert on error, `vibrateError()` should fire to give tactile feedback

---

### Task 13: Add optimistic UI to FoodAnalyzer food logging

**Issue:** FOO-232
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Write failing test:
   - Add test: "shows success immediately after tapping Log to Fitbit"
   - Verify: FoodLogConfirmation renders before fetch resolves
   - Run: `npm test -- src/components/__tests__/food-analyzer.test.tsx`

2. **GREEN** - Same optimistic pattern as Task 12:
   - In `handleLogToFitbit`, immediately set `logResponse` with provisional data built from `analysis`:
     ```typescript
     const optimisticResponse: FoodLogResponse = {
       fitbitLogId: 0,
       foodLogId: 0,
       foodName: analysis.food_name,
       calories: analysis.calories,
     };
     setLogResponse(optimisticResponse);
     ```
   - Fire API in background, revert on error
   - Same pattern for `handleUseExisting` (using existing food)
   - Run: `npm test -- src/components/__tests__/food-analyzer.test.tsx`

**Notes:**
- Both `handleLogToFitbit` and `handleUseExisting` in FoodAnalyzer should get optimistic treatment
- The `vibrateSuccess()` in FoodLogConfirmation will fire immediately — this is desirable UX

---

### Task 14: Check FoodLogResponse type compatibility

**Issue:** FOO-232
**Files:**
- `src/types/index.ts` (read — may need modification)
- `src/components/food-log-confirmation.tsx` (read — verify it handles placeholder IDs)

**Steps:**

1. Read `FoodLogResponse` type definition in `src/types/index.ts`
2. Read `FoodLogConfirmation` component to verify it doesn't display `fitbitLogId` or `foodLogId` to the user
3. If IDs are displayed, add a conditional to hide them when they're 0 (placeholder)
4. Run: `npm test -- src/components/__tests__/food-log-confirmation.test.tsx`

**Notes:**
- This is a verification task. May require no changes if the confirmation component doesn't show IDs.

---

### Task 15: Add SWR preload to dashboard

**Issue:** FOO-233
**Files:**
- `src/components/dashboard-prefetch.tsx` (create)
- `src/components/__tests__/dashboard-prefetch.test.tsx` (create)
- `src/app/app/page.tsx` (modify)

**TDD Steps:**

1. **RED** - Write failing test:
   - Create `src/components/__tests__/dashboard-prefetch.test.tsx`
   - Test that `DashboardPrefetch` component calls `preload` for `/api/common-foods` and `/api/food-history?limit=20` on mount
   - Run: `npm test -- src/components/__tests__/dashboard-prefetch.test.tsx`

2. **GREEN** - Create prefetch component:
   - Create `src/components/dashboard-prefetch.tsx`:
     ```typescript
     "use client";

     import { useEffect } from "react";
     import { preload } from "swr";

     // Fetcher matching the one used by QuickSelect and FoodHistory
     async function apiFetcher(url: string) {
       const response = await fetch(url);
       const result = await response.json();
       if (!result.success) throw new Error("Failed to load");
       return result.data;
     }

     export function DashboardPrefetch() {
       useEffect(() => {
         preload("/api/common-foods", apiFetcher);
         preload("/api/food-history?limit=20", apiFetcher);
       }, []);
       return null;
     }
     ```
   - Add `<DashboardPrefetch />` to `src/app/app/page.tsx` alongside existing components
   - Run: `npm test -- src/components/__tests__/dashboard-prefetch.test.tsx`

3. **REFACTOR**:
   - Extract the `apiFetcher` function to a shared location (e.g., `src/lib/swr.ts`) so QuickSelect, FoodHistory, and DashboardPrefetch all use the same fetcher. SWR deduplicates by key+fetcher, so using the same fetcher ensures cache hits.
   - Update QuickSelect (Task 10) and FoodHistory (Task 11) to import from `src/lib/swr.ts`
   - Run: `npm test`

**Notes:**
- `preload()` from SWR fires the request and populates the cache. When the user navigates to history or quick-select, `useSWR` with the same key returns cached data instantly.
- DashboardPrefetch renders `null` — no visible UI.
- The fetcher MUST be the same function reference used in the `useSWR` calls, otherwise SWR won't match the cache.

---

### Task 16: Update CLAUDE.md with performance conventions

**Issue:** FOO-234
**Files:**
- `CLAUDE.md` (modify)

**Steps:**

1. Add a PERFORMANCE section to CLAUDE.md after the STYLE section:
   ```markdown
   ## PERFORMANCE

   - **Every app route MUST have a `loading.tsx`** with `Skeleton` placeholders matching the page layout
   - **Cacheable GET routes** set `Cache-Control: private, max-age=N, stale-while-revalidate=M` (user-specific data = `private`)
   - **Client data fetching** uses `useSWR` with shared fetcher from `src/lib/swr.ts` — never raw `useState` + `fetch()`
   ```
2. Run: `npm run build` to verify no warnings

**Notes:**
- Keep it concise — only conventions that would cause mistakes if missing
- This task MUST be done last, after all performance patterns are implemented

---

### Task 17: Integration & Verification

**Issue:** FOO-229, FOO-230, FOO-231, FOO-232, FOO-233, FOO-234
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run build: `npm run build`
5. Verify zero warnings in all of the above
6. Manual verification:
   - [ ] Navigate between routes — loading skeletons appear briefly
   - [ ] Check Network tab — Cache-Control headers present on GET responses
   - [ ] Navigate to history, go back, navigate again — cached data shows instantly
   - [ ] Navigate to quick-select, go back, navigate again — cached data shows instantly
   - [ ] Log a food via quick-select — success shows immediately
   - [ ] Log a food via analyzer — success shows immediately

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| SWR fetch failure | Show error state (existing behavior) | Unit test |
| Optimistic update revert | Revert UI, show error, vibrate | Unit test |
| Fitbit token expired during optimistic flow | Revert optimistic UI, redirect to auth | Unit test |
| SWR cache miss | Show loading state, fetch fresh | Unit test |

## Risks & Open Questions

- [ ] **SWR fetcher identity**: The fetcher function passed to `useSWR` and `preload` must be the same reference for cache hits. Task 15 addresses this by extracting to `src/lib/swr.ts`.
- [ ] **FoodHistory pagination with SWR**: Only the first page uses SWR. "Load More" and "Jump to Date" bypass SWR. This is a pragmatic compromise — full SWR pagination would require a different data model.
- [ ] **Optimistic update timing**: The optimistic response uses placeholder IDs (`fitbitLogId: 0`, `foodLogId: 0`). If FoodLogConfirmation displays these, a conditional will be needed (covered in Task 14).

## Scope Boundaries

**In Scope:**
- Loading skeletons for all 5 app routes
- Cache-Control headers on 3 GET routes
- SWR adoption for FoodHistory (first page) and QuickSelect
- Optimistic UI for food logging in QuickSelect and FoodAnalyzer
- SWR prefetch from dashboard
- CLAUDE.md performance conventions

**Out of Scope:**
- Infinite scroll for FoodHistory (current "Load More" button is retained)
- Service Worker / offline caching
- Server-side caching (Redis, etc.)
- Performance monitoring / metrics
- Database query optimization

---

## Iteration 1

**Implemented:** 2026-02-08
**Method:** Agent team (4 workers)

### Tasks Completed This Iteration
- Task 1: Install shadcn/ui Skeleton component (lead)
- Task 2: Add loading.tsx to dashboard route (worker-1)
- Task 3: Add loading.tsx to analyze route (worker-1)
- Task 4: Add loading.tsx to history route (worker-1)
- Task 5: Add loading.tsx to quick-select route (worker-1)
- Task 6: Add loading.tsx to settings route (worker-1)
- Task 7: Add Cache-Control headers to GET /api/common-foods (worker-2)
- Task 8: Add Cache-Control headers to GET /api/food-history (worker-2)
- Task 9: Add Cache-Control: no-cache to GET /api/auth/session (worker-2)
- Task 10: Migrate QuickSelect to useSWR (worker-3)
- Task 11: Migrate FoodHistory to useSWR first page (worker-3)
- Task 12: Add optimistic UI to QuickSelect food logging (worker-3)
- Task 13: Add optimistic UI to FoodAnalyzer food logging (worker-4)
- Task 14: Check FoodLogResponse type compatibility (worker-4) - No changes needed
- Task 15: Add SWR preload to dashboard (worker-3)
- Task 16: Update CLAUDE.md with performance conventions (lead)
- Task 17: Integration & verification (lead)

### Files Modified
- `src/components/ui/skeleton.tsx` - Created (shadcn CLI)
- `src/app/app/loading.tsx` - Created dashboard loading skeleton
- `src/app/app/__tests__/loading.test.tsx` - Created (4 tests)
- `src/app/app/analyze/loading.tsx` - Created analyze loading skeleton
- `src/app/app/analyze/__tests__/loading.test.tsx` - Created (5 tests)
- `src/app/app/history/loading.tsx` - Created history loading skeleton
- `src/app/app/history/__tests__/loading.test.tsx` - Created (4 tests)
- `src/app/app/quick-select/loading.tsx` - Created quick-select loading skeleton
- `src/app/app/quick-select/__tests__/loading.test.tsx` - Created (3 tests)
- `src/app/settings/loading.tsx` - Created settings loading skeleton
- `src/app/settings/__tests__/loading.test.tsx` - Created (5 tests)
- `src/app/api/common-foods/route.ts` - Added Cache-Control header
- `src/app/api/common-foods/__tests__/route.test.ts` - Added Cache-Control test
- `src/app/api/food-history/route.ts` - Added Cache-Control header
- `src/app/api/food-history/__tests__/route.test.ts` - Added Cache-Control test
- `src/app/api/auth/session/route.ts` - Added Cache-Control header
- `src/app/api/auth/session/__tests__/route.test.ts` - Added Cache-Control test
- `src/components/quick-select.tsx` - Migrated to useSWR, added optimistic UI
- `src/components/__tests__/quick-select.test.tsx` - Updated for SWR + optimistic tests
- `src/components/food-history.tsx` - Migrated initial fetch to useSWR
- `src/components/__tests__/food-history.test.tsx` - Updated for SWR tests
- `src/components/food-analyzer.tsx` - Added optimistic UI to handleLogToFitbit and handleUseExisting
- `src/components/__tests__/food-analyzer.test.tsx` - Added optimistic UI tests
- `src/components/__tests__/food-analyzer-reprompt.test.tsx` - Updated for optimistic UI behavior
- `src/lib/swr.ts` - Created shared apiFetcher with error handling
- `src/lib/__tests__/swr.test.ts` - Created (6 tests)
- `src/components/dashboard-prefetch.tsx` - Created prefetch component
- `src/components/__tests__/dashboard-prefetch.test.tsx` - Created (3 tests)
- `src/app/app/page.tsx` - Added DashboardPrefetch component
- `src/app/app/__tests__/page.test.tsx` - Added DashboardPrefetch mock
- `CLAUDE.md` - Added PERFORMANCE section

### Linear Updates
- FOO-229: Todo → In Progress → Review
- FOO-230: Todo → In Progress → Review
- FOO-231: Todo → In Progress → Review
- FOO-232: Todo → In Progress → Review
- FOO-233: Todo → In Progress → Review
- FOO-234: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 8 issues; 2 fixed (apiFetcher error handling, test compatibility), 6 out of scope (pre-existing code)
- verifier: All 905 tests pass, zero warnings

### Work Partition
- Worker 1: Tasks 2-6 (loading skeletons — 10 files)
- Worker 2: Tasks 7-9 (Cache-Control headers — 6 files)
- Worker 3: Tasks 10-12, 15 (SWR migration + prefetch — 8 files)
- Worker 4: Tasks 13-14 (optimistic FoodAnalyzer + type compat — 5 files)
- Lead: Tasks 1, 16, 17 (skeleton install, CLAUDE.md, integration fixes)

### Continuation Status
All tasks completed.

## Status: COMPLETE
