# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-360-bugfixes-and-improvements
**Issues:** FOO-360, FOO-363, FOO-366, FOO-367, FOO-368
**Created:** 2026-02-13
**Last Updated:** 2026-02-13

## Summary

A batch of bugfixes, a security hardening, a convention fix, and one improvement:

1. **FOO-360 (High, Bug):** Fix fasting live timer negative duration — API sends today as `startDate` but `lastMealTime` is from yesterday, producing a future timestamp on the client.
2. **FOO-363 (Low, Security):** Consume OAuth state immediately after validation — both Google and Fitbit callbacks currently delete state after the full flow completes.
3. **FOO-366 (Low, Bug):** Replace `Promise.all` with `Promise.allSettled` for image processing — a single corrupt image currently kills the entire batch.
4. **FOO-367 (Low, Convention):** Fix relative imports in `src/db/` to use `@/` path alias.
5. **FOO-368 (Medium, Improvement):** Increase max photo limit from 3 to 9.

## Issues

### FOO-360: Fasting live timer shows negative duration

**Priority:** High
**Labels:** Bug
**Description:** The fasting card's live timer displays negative hours/minutes. The API route sets `startDate` to today's date, but `lastMealTime` comes from the previous day's last meal. The client constructs `new Date("${startDate}T${lastMealTime}")` — combining today's date with yesterday's meal time creates a future timestamp, so `now - future = negative`.

**Acceptance Criteria:**
- [ ] Live fasting timer shows positive elapsed time
- [ ] `startDate` in live mode is the previous day (when `lastMealTime` originated)
- [ ] Existing tests updated to verify correct `startDate`
- [ ] Fasting card test updated to use the previous day's date in `live.startDate`

### FOO-363: OAuth state token has replay window before invalidation

**Priority:** Low
**Labels:** Security
**Description:** Both Google and Fitbit OAuth callbacks validate the state parameter but delete it from the session only after the full flow completes. Moving state consumption to immediately after validation closes the replay window.

**Acceptance Criteria:**
- [ ] OAuth state is deleted from session immediately after validation, before token exchange begins
- [ ] Both Google and Fitbit callbacks are fixed
- [ ] Existing tests verify state is consumed before token exchange

### FOO-366: Promise.all on image operations fails entire batch on single error

**Priority:** Low
**Labels:** Bug
**Description:** Three locations use `Promise.all` for parallel image processing where a single corrupt file causes all images to fail. Using `Promise.allSettled` and filtering out failures allows partial success.

**Acceptance Criteria:**
- [ ] A single corrupt image in a multi-image batch does not prevent valid images from being processed
- [ ] User is notified which specific image(s) failed
- [ ] Server-side (`analyze-food/route.ts`) gracefully skips failed image buffers
- [ ] Client-side (`food-analyzer.tsx`) gracefully skips failed compressions
- [ ] Client-side (`photo-capture.tsx`) gracefully skips failed HEIC conversions

### FOO-367: Relative imports in src/db/ violate @/ path alias convention

**Priority:** Low
**Labels:** Convention
**Description:** Two files in `src/db/` use relative imports instead of the `@/` path alias required by CLAUDE.md.

**Acceptance Criteria:**
- [ ] `src/db/index.ts` imports schema via `@/db/schema`
- [ ] `src/db/migrate.ts` imports via `@/db/index`
- [ ] No relative imports remain in `src/db/`

### FOO-368: Increase max photo limit from 3 to 9

**Priority:** Medium
**Labels:** Improvement
**Description:** Photo capture allows only 3 images per analysis. The Claude API supports up to 20 images per request. Increasing to 9 allows multi-dish meals and multiple angles while keeping the grid layout clean (3x3).

**Acceptance Criteria:**
- [ ] `MAX_IMAGES` constant changed from 3 to 9
- [ ] `maxPhotos` default prop changed from 3 to 9
- [ ] `CLAUDE.md` Security section updated to reflect new limit
- [ ] Tests updated to reflect new constant value

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All existing tests pass

## Implementation Tasks

### Task 1: Fix fasting live timer negative duration (FOO-360)

**Issue:** FOO-360
**Files:**
- `src/app/api/fasting/route.ts` (modify)
- `src/app/api/fasting/__tests__/route.test.ts` (modify)
- `src/components/__tests__/fasting-card.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update the existing test "returns live mode for today with ongoing fast" in `src/app/api/fasting/__tests__/route.test.ts`:
   - Change the expected `startDate` from `"2026-02-12"` (today) to `"2026-02-11"` (previous day)
   - The mock already has `isToday` returning true for `"2026-02-12"`, and `getFastingWindow` returns a window with `lastMealTime` from the previous day
   - Run: `npm test -- src/app/api/fasting/__tests__/route.test.ts`
   - Verify: Test fails because `startDate` still equals today's date

2. **GREEN** — Fix `src/app/api/fasting/route.ts`:
   - Import `addDays` from `@/lib/date-utils`
   - In the live mode block (around line 47-51), change `startDate: date` to `startDate: addDays(date, -1)` — because `lastMealTime` comes from the previous day's entries
   - Run: `npm test -- src/app/api/fasting/__tests__/route.test.ts`
   - Verify: Test passes

3. **REFACTOR** — Update `src/components/__tests__/fasting-card.test.tsx`:
   - In the "displays live mode with pulsing indicator" and "updates live counter every minute" tests, the `live.startDate` is currently `"2026-02-12"` (same as window date). After the API fix, this should be the previous day `"2026-02-11"` for realism, since the API will now return the previous day
   - Adjust the mock `Date.now()` value and expected duration accordingly — with `startDate: "2026-02-11"` and `lastMealTime: "20:00:00"`, at `2026-02-12T23:00:00` the duration would be 27 hours. For simpler test math, change mock time to something like `2026-02-12T07:00:00` (11 hours after 8 PM yesterday)
   - Also update "cleans up timer on unmount" test's `live.startDate` to use previous day
   - Run: `npm test -- src/components/__tests__/fasting-card.test.tsx`
   - Verify: All fasting card tests pass

**Notes:**
- The `getFastingWindow` function in `src/lib/fasting.ts` already correctly queries the previous day and returns `lastMealTime` from `previousDayEntries` — no changes needed there
- The client-side `calculateLiveDuration` in `fasting-card.tsx` already works correctly with any `startDate` — the fix is purely in the API response

### Task 2: Consume OAuth state before token exchange (FOO-363)

**Issue:** FOO-363
**Files:**
- `src/app/api/auth/google/callback/route.ts` (modify)
- `src/app/api/auth/google/callback/__tests__/route.test.ts` (modify)
- `src/app/api/auth/fitbit/callback/route.ts` (modify)
- `src/app/api/auth/fitbit/callback/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add a new test in `src/app/api/auth/google/callback/__tests__/route.test.ts`:
   - Test name: "consumes OAuth state before token exchange"
   - Set up `mockExchangeGoogleCode` to capture the moment it's called and assert that `mockRawSession.oauthState` is already `undefined` at that point (use a mock implementation that checks `mockRawSession.oauthState` and stores the result)
   - Also verify `mockRawSession.save` was called before `exchangeGoogleCode`
   - Run: `npm test -- src/app/api/auth/google/callback/__tests__/route.test.ts`
   - Verify: Test fails because state is still present during token exchange

2. **GREEN** — Fix `src/app/api/auth/google/callback/route.ts`:
   - Move `delete rawSession.oauthState; await rawSession.save();` to immediately after the state validation block (after line 41, before the token exchange at line 47)
   - Remove the duplicate `delete rawSession.oauthState;` from line 77 (it will already be deleted)
   - Keep the `await rawSession.save()` at the end (line 78) since it now saves `sessionId`
   - Run: `npm test -- src/app/api/auth/google/callback/__tests__/route.test.ts`
   - Verify: All tests pass

3. **RED** — Add the same test pattern in `src/app/api/auth/fitbit/callback/__tests__/route.test.ts`:
   - Test name: "consumes OAuth state before token exchange"
   - Same approach: verify `mockRawSession.oauthState` is `undefined` when `exchangeFitbitCode` is called
   - Run: `npm test -- src/app/api/auth/fitbit/callback/__tests__/route.test.ts`
   - Verify: Test fails

4. **GREEN** — Fix `src/app/api/auth/fitbit/callback/route.ts`:
   - Move `delete rawSession.oauthState; await rawSession.save();` to immediately after state validation (after line 22, before the session check at line 24)
   - Remove the duplicate at lines 73-74
   - Keep `rawSession.save()` at end is no longer needed since there are no further session mutations — but the existing `save()` call is gone now. Actually, the Fitbit callback doesn't set any new session fields, so the only `save()` call was the one at line 74. After moving the state deletion earlier, we still need a `save()` call to persist the state deletion. The moved `save()` handles that.
   - Run: `npm test -- src/app/api/auth/fitbit/callback/__tests__/route.test.ts`
   - Verify: All tests pass

**Notes:**
- The Google callback has two session mutations: (1) delete oauthState, (2) set sessionId. After the fix, `oauthState` is cleared and saved early, then `sessionId` is set and saved at the end. Two `save()` calls total.
- The Fitbit callback only has one mutation: delete oauthState. After the fix, one `save()` call right after validation.
- Reference existing test patterns in `route.test.ts` — both files already have `mockRawSession` with `save` mock.

### Task 3: Fix relative imports in src/db/ (FOO-367)

**Issue:** FOO-367
**Files:**
- `src/db/index.ts` (modify)
- `src/db/migrate.ts` (modify)

**TDD Steps:**

1. **GREEN** — Fix `src/db/index.ts`:
   - Change `import * as schema from "./schema"` to `import * as schema from "@/db/schema"` (line 4)
   - Run: `npm run typecheck`
   - Verify: No type errors

2. **GREEN** — Fix `src/db/migrate.ts`:
   - Change `import { getDb, closeDb } from "./index"` to `import { getDb, closeDb } from "@/db/index"` (line 2)
   - Run: `npm run typecheck`
   - Verify: No type errors

3. **Verify** — Run full test suite:
   - Run: `npm test`
   - Verify: All tests pass (import resolution unchanged)

**Notes:**
- No new tests needed — this is a purely mechanical import path change
- The `@/` alias resolves to `src/` per tsconfig, so `@/db/schema` and `./schema` resolve to the same file

### Task 4: Increase max photo limit from 3 to 9 (FOO-368)

**Issue:** FOO-368
**Files:**
- `src/lib/image-validation.ts` (modify)
- `src/lib/__tests__/image-validation.test.ts` (modify)
- `src/components/photo-capture.tsx` (modify)
- `CLAUDE.md` (modify)

**TDD Steps:**

1. **RED** — Update `src/lib/__tests__/image-validation.test.ts`:
   - Change the `"MAX_IMAGES is 3"` test to expect `MAX_IMAGES` to be `9`
   - Run: `npm test -- src/lib/__tests__/image-validation.test.ts`
   - Verify: Test fails because `MAX_IMAGES` is still 3

2. **GREEN** — Update `src/lib/image-validation.ts`:
   - Change `export const MAX_IMAGES = 3` to `export const MAX_IMAGES = 9`
   - Run: `npm test -- src/lib/__tests__/image-validation.test.ts`
   - Verify: Test passes

3. **GREEN** — Update `src/components/photo-capture.tsx`:
   - Change default prop `maxPhotos = 3` to `maxPhotos = 9` (line 37)
   - Run: `npm test -- src/components/__tests__/photo-capture.test.tsx`
   - Verify: All photo-capture tests still pass

4. **GREEN** — Update `CLAUDE.md`:
   - In the Security section, change `max 3 images` to `max 9 images`
   - No test needed for documentation

**Notes:**
- The existing `grid-cols-3` CSS class in `photo-capture.tsx` handles 9 images cleanly (3 rows of 3)
- The `analyze-food` and `refine-food` routes both validate against `MAX_IMAGES` from `image-validation.ts`, so they automatically pick up the new limit
- No layout changes needed — the grid already works with any number of items

### Task 5: Replace Promise.all with resilient image processing (FOO-366)

**Issue:** FOO-366
**Files:**
- `src/app/api/analyze-food/route.ts` (modify)
- `src/app/api/analyze-food/__tests__/route.test.ts` (modify or create)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/photo-capture.tsx` (modify)

**TDD Steps:**

1. **RED** — Add a test for server-side resilience in `src/app/api/analyze-food/__tests__/route.test.ts` (create if needed):
   - Test that when one image's `arrayBuffer()` throws, the other images are still processed
   - Mock the session, create a FormData with 2 images where one has a failing `arrayBuffer()`
   - Expect the request to succeed with only the valid image(s) passed to `analyzeFood`
   - Run: `npm test -- src/app/api/analyze-food/__tests__/route.test.ts`
   - Verify: Test fails because `Promise.all` rejects on the first failure

2. **GREEN** — Fix `src/app/api/analyze-food/route.ts`:
   - Replace `Promise.all` (lines 103-112) with `Promise.allSettled`
   - Filter out rejected results, keeping only fulfilled ones
   - If all images fail, return an error response
   - Log a warning for each failed image (include index, not the image data)
   - If some images fail but at least one succeeds (and/or a description is present), proceed with the successful images
   - Run: `npm test -- src/app/api/analyze-food/__tests__/route.test.ts`
   - Verify: Test passes

3. **RED/GREEN** — Fix client-side `Promise.all` in `src/components/food-analyzer.tsx`:
   - Replace `Promise.all(photos.map(compressImage))` (line 89) with `Promise.allSettled`
   - Filter out rejected results, keeping only fulfilled blobs
   - If some images fail to compress, show a warning (not an error) via `setError` — e.g., "1 image could not be processed and was skipped"
   - If all images fail, show the error as before
   - This is a client component — no server-side test. Existing component tests should still pass.

4. **RED/GREEN** — Fix client-side `Promise.all` in `src/components/photo-capture.tsx`:
   - Replace `Promise.all(previewBlobPromises)` (line 131) with `Promise.allSettled`
   - Filter out rejected HEIC conversions, keeping successful previews
   - For failed HEIC conversions, exclude those photos from the preview list and notify the user
   - Match indices between `combinedPhotos` and settled results to correctly pair files with their previews
   - If all conversions fail, show error as before

5. **Verify** — Run full test suite:
   - Run: `npm test`
   - Verify: All tests pass

**Notes:**
- Pattern to follow for `Promise.allSettled`:
  ```
  const results = await Promise.allSettled(items.map(fn));
  const successes = results.filter(r => r.status === "fulfilled").map(r => r.value);
  const failCount = results.filter(r => r.status === "rejected").length;
  ```
- For the server-side route, log warnings for failed images using the standard pino logger
- For the client-side components, use `console.warn` (acceptable per CLAUDE.md for `'use client'` components)
- The user notification should be a non-blocking warning, not an error that prevents the flow

### Task 6: Integration & Verification

**Issue:** FOO-360, FOO-363, FOO-366, FOO-367, FOO-368
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Verify zero warnings across all checks

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Negative fasting duration | Show positive elapsed time from previous day | Unit test (route + component) |
| OAuth state replay | State consumed before token exchange | Unit test (both callbacks) |
| Single image fails in batch | Other images processed, user warned | Unit test (server route) |
| All images fail in batch | Error returned/shown | Unit test |

## Risks & Open Questions

- [ ] FOO-366: The `photo-capture.tsx` HEIC conversion uses matched indices between `combinedPhotos` and preview blobs. When filtering out failed conversions, the indices must stay aligned — the implementer needs to carefully pair photos with their corresponding previews.
- [ ] FOO-366: The `refine-food/route.ts` also has a `Promise.all` for image buffers (same pattern as `analyze-food`). The issue only lists `analyze-food` but the implementer should check and fix `refine-food` too for consistency.

## Scope Boundaries

**In Scope:**
- Fix fasting live timer `startDate` calculation
- Move OAuth state consumption before token exchange (both callbacks)
- Replace `Promise.all` with `Promise.allSettled` for image processing (3 locations + refine-food)
- Fix 2 relative imports in `src/db/`
- Change `MAX_IMAGES` from 3 to 9 and update docs

**Out of Scope:**
- Fasting calculation logic changes beyond `startDate` fix
- OAuth flow restructuring beyond state consumption timing
- Image processing retry logic or progressive upload
- Adding new photo grid layouts for 9 images (existing grid-cols-3 is fine)

---

## Iteration 1

**Implemented:** 2026-02-13
**Method:** Agent team (4 workers)

### Tasks Completed This Iteration
- Task 1: Fix fasting live timer negative duration (FOO-360) — Changed startDate to previous day in live mode using `addDays(date, -1)` (worker-1)
- Task 2: Consume OAuth state before token exchange (FOO-363) — Moved state deletion to immediately after validation in both Google and Fitbit callbacks (worker-2)
- Task 3: Fix relative imports in src/db/ (FOO-367) — Changed 2 relative imports to @/ path alias (worker-3)
- Task 4: Increase max photo limit from 3 to 9 (FOO-368) — Updated constant, default prop, and CLAUDE.md docs (worker-4)
- Task 5: Replace Promise.all with resilient image processing (FOO-366) — Promise.allSettled in analyze-food, refine-food, food-analyzer, photo-capture (worker-4)
- Task 6: Integration & Verification — Full test suite, lint, typecheck, build all pass

### Files Modified
- `src/app/api/fasting/route.ts` — Fixed live mode startDate to use previous day
- `src/app/api/fasting/__tests__/route.test.ts` — Updated test expectation for startDate
- `src/components/__tests__/fasting-card.test.tsx` — Updated 3 live mode tests with realistic dates
- `src/app/api/auth/google/callback/route.ts` — Moved state deletion before token exchange
- `src/app/api/auth/google/callback/__tests__/route.test.ts` — Added state consumption test
- `src/app/api/auth/fitbit/callback/route.ts` — Moved state deletion before token exchange
- `src/app/api/auth/fitbit/callback/__tests__/route.test.ts` — Added state consumption test
- `src/db/index.ts` — Changed relative import to @/db/schema
- `src/db/migrate.ts` — Changed relative import to @/db/index
- `src/lib/image-validation.ts` — Changed MAX_IMAGES from 3 to 9
- `src/lib/__tests__/image-validation.test.ts` — Updated test to expect 9
- `src/components/photo-capture.tsx` — Changed maxPhotos default to 9, Promise.allSettled for HEIC
- `src/components/__tests__/photo-capture.test.tsx` — Updated tests for resilient error messages
- `CLAUDE.md` — Updated max images from 3 to 9
- `src/app/api/analyze-food/route.ts` — Promise.allSettled for image buffers
- `src/app/api/analyze-food/__tests__/route.test.ts` — Added resilience test, updated limit test
- `src/app/api/refine-food/route.ts` — Promise.allSettled for image buffers + all-failed validation
- `src/app/api/refine-food/__tests__/route.test.ts` — Updated limit test
- `src/components/food-analyzer.tsx` — Promise.allSettled for image compression

### Linear Updates
- FOO-360: Todo → In Progress → Review
- FOO-363: Todo → In Progress → Review
- FOO-366: Todo → In Progress → Review
- FOO-367: Todo → In Progress → Review
- FOO-368: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 HIGH bug (missing all-images-failed validation in refine-food), fixed before proceeding
- verifier: All 1573 tests pass, zero warnings

### Work Partition
- Worker 1: Task 1 (fasting API files)
- Worker 2: Task 2 (OAuth callback files)
- Worker 3: Task 3 (db import files)
- Worker 4: Tasks 4, 5 (image validation, photo components, API routes)

### Continuation Status
All tasks completed.
