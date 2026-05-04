# Implementation Plan

**Created:** 2026-05-04
**Status:** ACTIVE
**Source:** Backlog: FOO-1011, FOO-1013, FOO-1014, FOO-1012
**Linear Issues:** [FOO-1011](https://linear.app/lw-claude/issue/FOO-1011), [FOO-1013](https://linear.app/lw-claude/issue/FOO-1013), [FOO-1014](https://linear.app/lw-claude/issue/FOO-1014), [FOO-1012](https://linear.app/lw-claude/issue/FOO-1012)
**Branch:** feat/fitbit-rate-limit-hardening

## Goal

Make Fitbit API usage architecturally bounded by the per-user 150-req/hour quota: honor upstream `Retry-After` (no retry amplification), expose rate-limit headroom for observability, gate optional reads via a token-level circuit breaker, and route external v1 endpoints through the in-process cache.

## Context Gathered

### Codebase Analysis

**Central Fitbit client:**
- `src/lib/fitbit.ts:7-10` — constants: `FITBIT_API_BASE`, `MAX_RETRIES = 3`, `REQUEST_TIMEOUT_MS = 10000`, `DEADLINE_MS = 30000`.
- `src/lib/fitbit.ts:65-124` — `fetchWithRetry`. Single choke point for ALL Fitbit reads/writes. 401 → `FITBIT_TOKEN_INVALID`. 403 → `FITBIT_SCOPE_MISSING`. 429 → exponential 1s/2s/4s up to MAX_RETRIES then `FITBIT_RATE_LIMIT`. 5xx → exponential retry then return as-is. `Retry-After` header is never parsed. `Fitbit-Rate-Limit-Remaining/Limit/Reset` headers are never read. The deadline check at line 72-75 throws `FITBIT_TIMEOUT` if total elapsed exceeds 30s.
- `src/lib/fitbit.ts:481-544` — `ensureFreshToken` with `refreshInFlight: Map<userId, Promise<string>>` for deduping concurrent refreshes. The model for any per-user in-memory state in this file.
- `src/lib/fitbit.ts:546-587` — `getFoodGoals` (currently used only by `/api/v1/nutrition-goals` per FOO-1008 audit; will be removed in a later chunk).
- `src/lib/fitbit.ts:749-793` — `getActivitySummary`. Standard fetch + retry path.

**Cache layer (already exists, used by internal routes):**
- `src/lib/fitbit-cache.ts:127-156` — `getCachedActivitySummary(userId, targetDate, log)`. 5-minute TTL, per-user-per-date keying, in-flight Promise dedup.
- `src/lib/fitbit-cache.ts:23-50` — `getCachedFitbitProfile`. 24h TTL.
- `src/lib/fitbit-cache.ts:54-86` — `getCachedFitbitWeightKg`. 1h TTL.
- `src/lib/fitbit-cache.ts:90-120` — `getCachedFitbitWeightGoal`. 24h TTL.
- `src/lib/fitbit-cache.ts:164-179` — `invalidateFitbitProfileCache(userId)` clears all four caches for one user.

**External v1 routes (bypass cache today):**
- `src/app/api/v1/activity-summary/route.ts:44-46` — `ensureFreshToken` + `getActivitySummary` direct call. Local rate limit 30/min/key.
- `src/app/api/v1/nutrition-goals/route.ts:33-34` — `ensureFreshToken` + `getFoodGoals` direct call. Same rate-limit pattern. (Slated for repurposing in FOO-1008 — out of scope here. We add caching to the activity route only and let the nutrition-goals route be addressed when its shape changes.)

**Type definitions:**
- `src/types/index.ts:134-152` — `ErrorCode` union; new typed errors must be added here.
- `src/types/index.ts:148-150` — existing `FITBIT_RATE_LIMIT`, `FITBIT_REFRESH_TRANSIENT` codes.

**Test patterns:**
- `src/lib/__tests__/fitbit.test.ts:891-918` — existing 429-retry test for `createFood` shows the `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(1000)` pattern.
- `src/lib/__tests__/fitbit.test.ts:1140-1248` — `fetchWithRetry 5xx handling` shows the direct test surface for retry behavior.
- `src/lib/__tests__/fitbit.test.ts:1282-1331` — `fetchWithRetry deadline` shows the elapsed-time test pattern.
- `src/lib/__tests__/fitbit-cache.test.ts` — uses `vi.resetModules()` + dynamic `await import("@/lib/fitbit-cache")` per `beforeEach` so each test gets fresh `Map` state. The same pattern is needed for the new headroom store.
- `src/app/api/v1/activity-summary/__tests__/route.test.ts` — existing pattern mocks `ensureFreshToken` + `getActivitySummary` directly. Must be updated to mock `getCachedActivitySummary` after the route change.

**Logger:**
- `src/lib/logger.ts` — pino. `logger.warn`, `logger.info`, `logger.debug`. Always pass a structured `{action, ...}` object as first arg, message as second.

**API conventions:**
- `src/lib/api-response.ts` — `successResponse`, `errorResponse`, `conditionalResponse` (ETag).
- All v1 routes use `validateApiRequest` (Bearer API key) from `src/lib/api-auth.ts`.
- Route handlers MUST NOT import `src/db/` directly per CLAUDE.md.

**Sentry (per CLAUDE.md):**
- Project: `food-scanner`. Logger integrates via Sentry's pino transport in production.
- For breadcrumbs, use Sentry SDK directly (`Sentry.addBreadcrumb`). Don't add a new dependency — Sentry is already configured.

### MCP Context

**Linear MCP:**
- Used to move issues to "In Progress" / "Done" during implementation.
- All four issues (FOO-1011, FOO-1012, FOO-1013, FOO-1014) currently in Backlog.

**Railway MCP:** No infra changes in this chunk. No env-var additions.

**Sentry MCP:** No new Sentry projects/DSNs needed; existing config will receive new breadcrumbs and warnings via the standard logger.

### Triage Results

**Valid (will be planned):**
- FOO-1011 — confirmed `fetchWithRetry` at `fitbit.ts:94-105` does fixed exponential and never reads `Retry-After`.
- FOO-1013 — confirmed no header parsing in `fetchWithRetry`; no headroom snapshot exists anywhere.
- FOO-1014 — confirmed no circuit breaker exists; depends on FOO-1013's snapshot.
- FOO-1012 — confirmed `/api/v1/activity-summary` calls `getActivitySummary` directly (line 46), bypassing `getCachedActivitySummary`. The `/api/v1/nutrition-goals` route also bypasses cache but is being repurposed in FOO-1008 — we leave that route alone in this chunk and only fix the activity route.

**Canceled:** None.

### Scope Boundaries

**In scope:**
- Modify `src/lib/fitbit.ts` (`fetchWithRetry` and supporting helpers).
- Create `src/lib/fitbit-rate-limit.ts` for the headroom store and circuit-breaker logic.
- Modify `src/app/api/v1/activity-summary/route.ts` to use the cache layer.
- Add new `ErrorCode` values to `src/types/index.ts`.
- Update existing tests; add new tests.

**Out of scope (deferred to later chunks):**
- Repurposing `/api/v1/nutrition-goals` to engine output (FOO-1008, Chunk C).
- Stale-response fallback in cache layers when circuit breaker rejects (will be revisited in Chunk B / C as needed; for now, breaker rejections surface as the typed error and callers handle it).
- Tightening v1 local rate limits (kept at 30/min for now; revisit in Chunk C alongside FOO-1008).

---

## Tasks

### Task 1: Add `FITBIT_RATE_LIMIT_LOW` to `ErrorCode` union

**File:** `src/types/index.ts`

**RED:**
- Add a test in `src/types/__tests__/index.test.ts` (create if missing) that asserts `"FITBIT_RATE_LIMIT_LOW"` is assignable to `ErrorCode`. Pattern: a `const x: ErrorCode = "FITBIT_RATE_LIMIT_LOW"` line — TypeScript catches misalignment at compile time. Run `npm run typecheck`.

**GREEN:**
- Add `"FITBIT_RATE_LIMIT_LOW"` to the `ErrorCode` union in `src/types/index.ts:134-152`, between the existing Fitbit codes.

**REFACTOR:**
- None. Type-only change.

**Verify:** `npm run typecheck` passes.

---

### Task 2: Read and store Fitbit rate-limit headers (FOO-1013)

**Files:**
- New: `src/lib/fitbit-rate-limit.ts`
- New: `src/lib/__tests__/fitbit-rate-limit.test.ts`

**Behavior spec:**
- Module exports `recordRateLimitHeaders(userId, response, log?)` and `getRateLimitSnapshot(userId)`.
- `recordRateLimitHeaders` parses three headers from a `Response`: `Fitbit-Rate-Limit-Limit`, `Fitbit-Rate-Limit-Remaining`, `Fitbit-Rate-Limit-Reset`. All three are integer strings.
- Stores per-user in a module-level `Map<userId, { limit: number; remaining: number; resetAt: number }>` where `resetAt = Date.now() + reset_seconds * 1000`.
- If any header is missing or NaN, do not update the snapshot (keeps last good value).
- Logs at `warn` when crossing into `remaining < 30`. Uses an internal "last logged threshold" per user to avoid log spam — only log when the threshold tier changes (≥30 → <30 → <10).
- `getRateLimitSnapshot(userId)` returns the current snapshot or `null` if never observed. Returns `null` if `resetAt < Date.now()` (snapshot is stale; treated as full budget by callers).
- Module exports `_resetForTests()` that clears the internal map and threshold-log state — for use in `beforeEach`.

**RED:**
- Test: `recordRateLimitHeaders` with all three headers populates the snapshot — assert via `getRateLimitSnapshot`.
- Test: missing header leaves prior snapshot unchanged.
- Test: a response that brings remaining from 50 → 25 emits a `warn` log call (mock the logger).
- Test: a response that brings remaining from 25 → 20 does NOT emit another `warn` (already in <30 tier).
- Test: a response that brings remaining from 20 → 8 emits another `warn` (crossed into <10 tier).
- Test: `getRateLimitSnapshot` returns `null` when `resetAt < Date.now()` (use `vi.setSystemTime`).
- Test: per-user isolation — recording for `user-a` does not affect `user-b`'s snapshot.

**GREEN:**
- Implement parsing + Map store + threshold-log gating.

**REFACTOR:**
- Extract threshold-tier classification into a small helper if multiple callers emerge.

**Verify:** `npx vitest run src/lib/__tests__/fitbit-rate-limit.test.ts`

---

### Task 3: Wire `recordRateLimitHeaders` into `fetchWithRetry` (FOO-1013)

**File:** `src/lib/fitbit.ts`

**Behavior spec:**
- After every `fetch` call returns (regardless of status, including 429), and BEFORE the status-class branches, parse rate-limit headers via `recordRateLimitHeaders`.
- Requires the userId — extract it from the bearer token in `options.headers.Authorization`. Walking the auth header is brittle, so add a new optional parameter `userId?: string` to `fetchWithRetry` and pass it from each caller (`getFitbitProfile`, `getFitbitLatestWeightKg`, `getFitbitWeightGoal`, `getActivitySummary`, `createFood`, `logFood`, `deleteFoodLog`, `getFoodGoals`). Each of these already receives `accessToken` only; their callers know the userId only sometimes (`ensureFreshToken` knows it; the cache layer knows it; the route handlers know it). Solution: thread `userId` through from `ensureFreshToken` callers down to `fetchWithRetry`. For callers that don't have it (rare — see audit), log without per-user attribution and skip the snapshot update.
- Add a Sentry breadcrumb on every Fitbit call with `{ category: "fitbit", level: "info", data: { url, status, remaining: snapshot.remaining } }`.

**Implementation approach:**
- `fetchWithRetry(url, options, retryCount, startTime, log, userId?)` — userId becomes the 6th param (optional).
- In the body, after `await fetch(...)`, call `recordRateLimitHeaders(userId, response, log)` only when `userId` is defined.
- All public functions in `fitbit.ts` that already receive an `accessToken` get an optional `userId` param appended; they pass it through to `fetchWithRetry`. This is a breaking-by-default change for the public function signatures.
- Update each caller (cache layer, route handlers, food-log paths) to pass userId.

**RED:**
- New test in `fitbit.test.ts`: `fetchWithRetry` records snapshot from response headers when userId is provided. Mock `recordRateLimitHeaders` and assert it was called with the parsed userId and the response.
- New test: when `userId` is undefined, snapshot recording is skipped (no call to `recordRateLimitHeaders`).
- Update `getActivitySummary` test: assert userId is threaded through and that mocked `recordRateLimitHeaders` receives it.

**GREEN:**
- Add `userId` param to `fetchWithRetry` and to each public function that calls it. Thread `userId` through from `ensureFreshToken` callers.
- Update all internal `fetchWithRetry(url, opts, 0, Date.now(), l)` call sites in `fitbit.ts` to `fetchWithRetry(url, opts, 0, Date.now(), l, userId)`.

**REFACTOR:**
- None.

**Verify:** `npx vitest run src/lib/__tests__/fitbit.test.ts src/lib/__tests__/fitbit-rate-limit.test.ts` — all green.

**Note:** This task touches a lot of call sites. Keep the public-function signatures source-of-truth in this task; the cache layer and route updates are in Tasks 4 and 6.

---

### Task 4: Update `fitbit-cache.ts` to thread `userId` through to fetch helpers

**File:** `src/lib/fitbit-cache.ts`

**Behavior spec:**
- Each `getCachedFitbit*` function already receives `userId`. Pass it to the underlying `getFitbit*` / `getActivitySummary` calls.

**RED:**
- Update existing `fitbit-cache.test.ts` mocks: assert that `mockGetFitbitProfile` etc. are called with `(token, log, userId)` (or whatever the new signature is). Tests should fail on the old signature.

**GREEN:**
- Update each callsite in `fitbit-cache.ts` lines 39-40, 75-76, 109-110, 145-146 to pass `userId` as the third argument.

**REFACTOR:**
- None.

**Verify:** `npx vitest run src/lib/__tests__/fitbit-cache.test.ts`

---

### Task 5: Honor `Retry-After` header on 429 (FOO-1011)

**File:** `src/lib/fitbit.ts`

**Behavior spec:**
- Replace the existing 429 branch (lines 94-105) with new logic:
  - Parse `Retry-After` header. RFC 7231 allows two formats: integer seconds OR HTTP-date. Accept either; for HTTP-date, compute seconds = max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000)).
  - **If `Retry-After` is present:**
    - If `retryAfterMs > (DEADLINE_MS - elapsed)` → throw `FITBIT_RATE_LIMIT` immediately. NO retry. Log at `warn` with `{retryAfterMs, deadlineRemaining}`.
    - Else → sleep `retryAfterMs`, retry once. If the retry also returns 429, throw `FITBIT_RATE_LIMIT` (no further retries).
  - **If `Retry-After` is absent:**
    - Allow at most 1 retry (cap from 3 → 1) with a fixed 1s delay. If the retry also returns 429, throw `FITBIT_RATE_LIMIT`.
- Existing 5xx retry behavior is unchanged.
- Always call `recordRateLimitHeaders` first (covered in Task 3) so a 429 still updates the snapshot via the `Fitbit-Rate-Limit-*` headers.

**RED:**
- Test: 429 with `Retry-After: 60` → mock fetch returns 429 then 200; assert `setTimeout` was called with ~60_000ms; assert success after retry.
- Test: 429 with `Retry-After: 3600` (or any value > remaining deadline of ~30s) → throws `FITBIT_RATE_LIMIT` immediately, no retry attempted (assert `fetch` called exactly once).
- Test: 429 without `Retry-After` → at most 1 retry with 1s delay; if second response is 429, throws `FITBIT_RATE_LIMIT`. Assert `fetch` called exactly twice.
- Test: 429 with `Retry-After` HTTP-date format (e.g., `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`) → computes seconds correctly. Use `vi.setSystemTime` to make the date relative.
- Test: malformed `Retry-After` (e.g., `Retry-After: abc`) → fall back to no-header behavior (1 retry, 1s).

**GREEN:**
- Replace the 429 branch in `fetchWithRetry`. Add a small `parseRetryAfter(value: string | null): number | null` helper (returns ms or null).
- Update the existing "retries on 429" tests at `fitbit.test.ts:891`, `:1427`, `:1660` — they all assume the old 1s/2s/4s pattern. Update them to use the new behavior (single retry, 1s, then succeed) or replace with `Retry-After`-aware variants.

**REFACTOR:**
- Move `parseRetryAfter` to a top-level non-exported helper for testability.

**Verify:** `npx vitest run src/lib/__tests__/fitbit.test.ts`

**Migration note:** None — this is a behavioral change with no DB or API contract impact.

---

### Task 6: Add the token-level circuit breaker (FOO-1014)

**File:** `src/lib/fitbit-rate-limit.ts` (extend the module from Task 2)

**Behavior spec:**
- New exported type `FitbitCallCriticality = "critical" | "important" | "optional"`.
- New exported function `assertRateLimitAllowed(userId, criticality)` — throws `FITBIT_RATE_LIMIT_LOW` if the breaker would block, returns `void` otherwise.
- Decision logic, using `getRateLimitSnapshot(userId)`:
  - Snapshot is `null` (never seen, or stale past `resetAt`) → allow all (assume full budget).
  - `remaining >= 20` → allow all.
  - `5 <= remaining < 20` → allow `critical` and `important`; reject `optional` with `FITBIT_RATE_LIMIT_LOW`.
  - `remaining < 5` → allow `critical` only; reject `important` and `optional` with `FITBIT_RATE_LIMIT_LOW`.
- Thresholds are non-configurable in this iteration (hardcoded constants `BREAKER_OPTIONAL_FLOOR = 20`, `BREAKER_IMPORTANT_FLOOR = 5`).
- When the breaker rejects, log at `warn` with `{userId, criticality, remaining}`.

**Call-site classification (used in Task 7):**
- **`critical`:** writes (`createFood`, `logFood`, `deleteFoodLog`) and OAuth refresh. Always proceed (warn-log if remaining < 5 but never block).
- **`important`:** explicit user-driven reads — `/api/fitbit/profile?refresh=1` (settings refresh button), the first computation of today's `getOrComputeDailyGoals` (when row is missing).
- **`optional`:** background reads — cache-hit fast-path's `getCachedFitbitProfile`/`getCachedFitbitWeightGoal` re-fetches in `daily-goals.ts:104-107`, `getCachedActivitySummary` calls from any context, partial-state recomputes.

**RED:**
- Test: snapshot null → all criticalities allowed.
- Test: stale snapshot (resetAt past) → all allowed.
- Test: remaining=50 → all allowed.
- Test: remaining=15 → critical allowed, important allowed, optional throws `FITBIT_RATE_LIMIT_LOW`.
- Test: remaining=4 → critical allowed, important throws, optional throws.
- Test: rejection log includes the snapshot's remaining count.
- Use `_resetForTests` from Task 2 to clear state between cases.

**GREEN:**
- Implement `assertRateLimitAllowed`. Use the constants and the snapshot accessor from Task 2.

**REFACTOR:**
- None.

**Verify:** `npx vitest run src/lib/__tests__/fitbit-rate-limit.test.ts`

---

### Task 7: Apply the circuit breaker at fetch sites (FOO-1014)

**File:** `src/lib/fitbit.ts`

**Behavior spec:**
- `fetchWithRetry` accepts a new optional `criticality?: FitbitCallCriticality` param (default `"optional"` — most reads are optional).
- BEFORE calling `fetch`, if `userId` is defined, call `assertRateLimitAllowed(userId, criticality)`. If it throws, propagate.
- Each public function in `fitbit.ts` accepts an optional `criticality` param (or sets it via a sensible default per function):
  - `createFood`, `logFood`, `deleteFoodLog`, `refreshFitbitToken` → `"critical"` (hardcoded — never overridden).
  - `getFitbitProfile`, `getFitbitLatestWeightKg`, `getFitbitWeightGoal`, `getActivitySummary`, `getFoodGoals` → default `"optional"`, callers can override to `"important"`.

**RED:**
- Test: `getActivitySummary` with userId where snapshot has remaining=15 and criticality undefined → throws `FITBIT_RATE_LIMIT_LOW` (because default optional).
- Test: `getActivitySummary` with userId, criticality=`"important"`, remaining=15 → proceeds (calls fetch).
- Test: `createFood` with userId, remaining=10 → proceeds (critical, never blocked above remaining=0).
- Test: `createFood` with remaining=2 → still proceeds (critical), but emits a warn-log.
- Test: `getFitbitProfile` with no userId → no breaker check (proceeds — defensive default).

**GREEN:**
- Add the `criticality` param plumbing through all public fitbit functions.
- Hardcode `"critical"` for write/refresh functions; allow caller override for read functions via an extra param.

**REFACTOR:**
- None.

**Verify:** `npx vitest run src/lib/__tests__/fitbit.test.ts`

---

### Task 8: Mark internal call sites with appropriate criticality

**Files:**
- `src/lib/daily-goals.ts`
- `src/app/api/fitbit/profile/route.ts`
- `src/lib/fitbit-cache.ts`

**Behavior spec:**
- `daily-goals.ts:104-107` (cache-hit fast path's profile/weightGoal re-fetch) — pass `criticality: "optional"` (already default; no change but verify with a test assertion). Catch `FITBIT_RATE_LIMIT_LOW` and **return the stored row's macros without the audit's freshly-computed bmiTier/goalType** — fall back to whatever audit fields can be reconstructed without those calls; if not enough info, return audit with `bmiTier` derived from stored `weightKg + cached profile if available else "lt25"`. Better: catch and SKIP the re-fetch silently, returning audit with last known values from the row. Test this fallback.
- `daily-goals.ts:133-138` (full-compute fan-out) — the activity call here is what produces the row for today; mark `criticality: "important"`. The profile/weight/weight-goal calls are also `important` (this is the first compute of the day). If any throws `FITBIT_RATE_LIMIT_LOW`, propagate to the caller — the API route maps it to a 503 error response.
- `app/api/fitbit/profile/route.ts:30-34` — the 3-fetch fan-out is a user-explicit refresh (especially with `?refresh=1`); pass `criticality: "important"`. Catch `FITBIT_RATE_LIMIT_LOW` and surface as a typed error (see Task 9).
- `fitbit-cache.ts` — the cache wrappers themselves don't need to set criticality; they pass through whatever the caller specified. But the wrappers DO need to accept a `criticality` parameter and pass it through to the underlying fetch. Default to `"optional"` if omitted (preserves the current most-conservative behavior for any caller that doesn't think about it).

**RED:**
- Test: cache-hit fast path in `daily-goals.ts` — when `getCachedFitbitWeightGoal` throws `FITBIT_RATE_LIMIT_LOW`, the function still returns `status: "ok"` with the row's stored macros and a degraded audit (e.g., `goalType` falls back to `"MAINTAIN"` and a comment in the response indicates degraded state).
- Test: full-compute path with `criticality: "important"` — a `FITBIT_RATE_LIMIT_LOW` from `getCachedActivitySummary` propagates as an unhandled error (caught by the route handler).

**GREEN:**
- Update the call sites and add the catch handlers.

**REFACTOR:**
- Extract a small `withFallback(fn, fallbackValue)` helper if the catch-and-default pattern appears in multiple places.

**Verify:** `npx vitest run src/lib/__tests__/daily-goals.test.ts`

---

### Task 9: Map `FITBIT_RATE_LIMIT_LOW` to HTTP 503 in route handlers

**Files:**
- `src/app/api/nutrition-goals/route.ts`
- `src/app/api/fitbit/profile/route.ts`
- `src/app/api/v1/activity-summary/route.ts` (after Task 10 wires it through cache)

**Behavior spec:**
- Each route's existing error-mapping `if (error.message === "FITBIT_*")` chain gains a new branch: `if (error.message === "FITBIT_RATE_LIMIT_LOW")` → return `errorResponse("FITBIT_RATE_LIMIT_LOW", "Fitbit rate-limit headroom is low. Please try again in a few minutes.", 503)`.

**RED:**
- For each route, add a test: when `getOrComputeDailyGoals` (or analog) rejects with `FITBIT_RATE_LIMIT_LOW`, the route returns 503 with the typed error code.

**GREEN:**
- Add the mapping branches.

**REFACTOR:**
- If three routes have nearly-identical mapping blocks, extract a `mapFitbitErrorToResponse(error)` helper into `src/lib/api-response.ts` (optional cleanup).

**Verify:** `npx vitest run src/app/api/nutrition-goals/__tests__ src/app/api/fitbit/profile/__tests__ src/app/api/v1/activity-summary/__tests__`

---

### Task 10: Route `/api/v1/activity-summary` through `getCachedActivitySummary` (FOO-1012)

**File:** `src/app/api/v1/activity-summary/route.ts`

**Behavior spec:**
- Replace direct `getActivitySummary(accessToken, date, log)` call (line 46) with `getCachedActivitySummary(authResult.userId, date, log)`.
- Remove the now-unused `ensureFreshToken` call at line 45 — `getCachedActivitySummary` calls it internally.
- Remove the import of `ensureFreshToken, getActivitySummary` at line 4; replace with `getCachedActivitySummary` from `@/lib/fitbit-cache`.
- Add the breaker-error mapping branch from Task 9.
- The local 30/min rate-limit (lines 7-30) stays as-is for this iteration — tightening is in Chunk C.

**RED:**
- Update `src/app/api/v1/activity-summary/__tests__/route.test.ts`:
  - Replace `mockGetActivitySummary` and `mockEnsureFreshToken` with a single `mockGetCachedActivitySummary`.
  - Add a test: `getCachedActivitySummary` is called with `(userId, date, log)` and its result is returned to the client.
  - Add a test: when `mockGetCachedActivitySummary` rejects with `FITBIT_RATE_LIMIT_LOW`, the route returns 503.
  - Existing FITBIT_TOKEN_INVALID / FITBIT_RATE_LIMIT / FITBIT_API_ERROR error-mapping tests must keep passing — `getCachedActivitySummary` rethrows these from the underlying fetch call.

**GREEN:**
- Apply the import + call swap. Add the new error mapping branch.

**REFACTOR:**
- None.

**Verify:** `npx vitest run src/app/api/v1/activity-summary/__tests__/route.test.ts`

---

### Task 11: Verify cache hit reduces Fitbit calls in v1 path

**File:** `src/app/api/v1/activity-summary/__tests__/route.test.ts`

**Behavior spec:**
- Add an integration-style test in the existing route test file (still mocked at the unit level): two sequential `GET /api/v1/activity-summary?date=2026-05-04` calls — assert the underlying `getActivitySummary` (one layer below `getCachedActivitySummary`) is invoked exactly once. This requires NOT mocking `getCachedActivitySummary` directly; instead mock the lower-level `getActivitySummary` from `@/lib/fitbit` and let the real cache layer dedup.

**Approach:** the test imports `vi.resetModules()` between scenarios and uses the fitbit-cache test pattern (dynamic re-import) to get fresh state.

**RED:**
- The test fails today because the route bypasses cache. After Task 10 it should pass.

**GREEN:**
- No new code; this is a confidence test that Task 10's intent works end-to-end at the route layer.

**REFACTOR:**
- None.

**Verify:** `npx vitest run src/app/api/v1/activity-summary/__tests__/route.test.ts`

---

### Task 12: Documentation + post-implementation sweep

**Files:**
- `CLAUDE.md` (small addition)
- `MIGRATIONS.md` (no entry needed — no DB changes)

**Behavior spec:**
- Add a short section under "KNOWN ACCEPTED PATTERNS" or a new section in CLAUDE.md describing the criticality classification:
  - "All Fitbit reads/writes route through `fetchWithRetry`. Each call carries a criticality (`critical` / `important` / `optional`) that gates execution against the per-user rate-limit snapshot. Writes are always critical. User-driven explicit reads are important. Background revalidations are optional. The breaker rejects with `FITBIT_RATE_LIMIT_LOW` (HTTP 503)."
- Confirm no `MIGRATIONS.md` entry is needed (no schema, no env-var, no token format change).

**RED:**
- Not applicable (documentation task). Run `npm run build` to ensure CLAUDE.md edits don't break anything indirectly (it shouldn't).

**GREEN:**
- Edit CLAUDE.md.

**REFACTOR:**
- None.

**Verify:** `npm run build` and `npm test` pass.

---

## Post-Implementation Checklist

- [ ] `npm test` passes (all suites green).
- [ ] `npm run typecheck` passes (no errors).
- [ ] `npm run lint` passes (zero warnings per CLAUDE.md "Zero warnings policy").
- [ ] `npm run build` succeeds.
- [ ] All four issues moved to "Done" in Linear (FOO-1011, FOO-1012, FOO-1013, FOO-1014).
- [ ] No new entries needed in `MIGRATIONS.md` (verified — no schema or env changes).
- [ ] Manual smoke test: hit `/api/fitbit/profile` and `/api/v1/activity-summary?date=$today` and confirm successful responses, then check pino logs for the new "rate_limit_warn" structured logs (only fire if `Fitbit-Rate-Limit-Remaining < 30`).
- [ ] Bug-hunter review on the fitbit.ts diff before PR (it's the most invasive change).

---

## Plan Summary

**Issues planned:** 4
- FOO-1011 (Honor Retry-After) — Tasks 1, 5
- FOO-1013 (Read rate-limit headers) — Tasks 2, 3, 4
- FOO-1014 (Circuit breaker) — Tasks 1, 6, 7, 8, 9
- FOO-1012 (v1 caching) — Tasks 10, 11

**Issues canceled:** 0

**Tasks:** 12

**Files created:**
- `src/lib/fitbit-rate-limit.ts`
- `src/lib/__tests__/fitbit-rate-limit.test.ts`

**Files modified:**
- `src/lib/fitbit.ts` (largest change — userId + criticality threading)
- `src/lib/fitbit-cache.ts` (userId/criticality pass-through)
- `src/lib/daily-goals.ts` (criticality at call sites + breaker fallback)
- `src/app/api/fitbit/profile/route.ts` (criticality + 503 mapping)
- `src/app/api/nutrition-goals/route.ts` (503 mapping)
- `src/app/api/v1/activity-summary/route.ts` (cache + 503 mapping)
- `src/types/index.ts` (new ErrorCode)
- `CLAUDE.md` (criticality classification doc)
- Existing test files for the routes and lib modules above.

**Sequence note:** Tasks must run roughly in order; Task 3 introduces the userId param that Task 4 then propagates. Task 5 (Retry-After) is independent of the breaker work and could be parallelized in a worker pool, but the test files overlap with Task 3's, so single-track is safer.

**Risk:** the userId-threading change in Task 3 ripples through every public function in `fitbit.ts` and every caller. Carefully count the call sites before starting and lean on TypeScript to catch missed sites — `tsc --noEmit` after each pass.
