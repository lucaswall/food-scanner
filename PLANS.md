# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-327-date-nav-and-api-access
**Issues:** FOO-327, FOO-329, FOO-328
**Created:** 2026-02-11
**Last Updated:** 2026-02-11

## Summary

Three features planned together: (1) date navigation on the daily dashboard so users can view past days, (2) API key authentication for external access, and (3) a public `/api/v1/` namespace exposing user data to scripts and tools. FOO-327 is independent. FOO-328 depends on FOO-329.

## Issues

### FOO-327: Date Navigation for Daily Dashboard

**Priority:** Medium
**Labels:** Feature
**Description:** The daily dashboard only shows today's data. Users can't view nutrition for a past day without going to the history page (which shows a list, not the rich dashboard view). All APIs already accept `?date=` parameters — only the frontend needs a date selector, plus a new endpoint for the earliest food log entry date.

**Acceptance Criteria:**
- [ ] Left/right arrows navigate between days on the dashboard
- [ ] Date label displayed between arrows shows the selected date
- [ ] "Today" indicator visible when viewing today
- [ ] Right arrow disabled on today; left arrow disabled at earliest food log entry date
- [ ] Dashboard empty state ("No food logged") for dates with no entries
- [ ] Client state only — no URL query params
- [ ] `getTodayDate()` extracted from duplicated locations into shared utility

### FOO-329: No API Key Authentication for External Access

**Priority:** Medium
**Labels:** Feature
**Description:** The app only supports session-based auth via Google OAuth (requires a browser). There's no way for external scripts or tools to authenticate. Need an `api_keys` table, key generation/revocation in settings, and middleware to validate `Authorization: Bearer <key>` headers.

**Acceptance Criteria:**
- [ ] New `api_keys` table (userId, hashed key, name, created_at, last_used_at, revoked_at)
- [ ] Settings page section to generate, name, and revoke API keys
- [ ] Key shown to user exactly once at creation time
- [ ] Keys stored hashed (SHA-256) — raw key never persisted
- [ ] `Authorization: Bearer <key>` header validated via lookup of hashed value
- [ ] `last_used_at` updated on successful validation
- [ ] Revoked keys rejected

### FOO-328: No Programmatic Access to User Data

**Priority:** Medium
**Labels:** Feature
**Description:** External scripts can't access food log data, nutrition summaries, or other user information. All endpoints require session cookies. Need a `/api/v1/` namespace with clean JSON responses authenticated via API keys (FOO-329). Must cover: nutrition summary, food log entries, activity summary, nutrition goals, and lumen goals.

**Acceptance Criteria:**
- [ ] `/api/v1/` namespace authenticated via API key (not session cookies)
- [ ] `GET /api/v1/nutrition-summary?date=YYYY-MM-DD` returns daily nutrition summary
- [ ] `GET /api/v1/food-log?date=YYYY-MM-DD` returns food log entries for a date
- [ ] `GET /api/v1/activity-summary?date=YYYY-MM-DD` returns activity data
- [ ] `GET /api/v1/nutrition-goals` returns calorie/macro goals
- [ ] `GET /api/v1/lumen-goals?date=YYYY-MM-DD` returns Lumen goals
- [ ] All responses use the existing `successResponse`/`errorResponse` format
- [ ] Proper error codes for missing/invalid API key

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Database migrations are up to date
- [ ] All existing tests pass

## Implementation Tasks

---

### Task 1: Extract Date Utility Module

**Issue:** FOO-327
**Files:**
- `src/lib/date-utils.ts` (create)
- `src/lib/__tests__/date-utils.test.ts` (create)
- `src/components/daily-dashboard.tsx` (modify)
- `src/app/api/lumen-goals/route.ts` (modify)
- `src/components/lumen-banner.tsx` (modify)

**TDD Steps:**

1. **RED** — Create `src/lib/__tests__/date-utils.test.ts` with tests for:
   - `getTodayDate()` returns `YYYY-MM-DD` format string
   - `formatDisplayDate(dateStr)` returns a human-readable label: "Today" for today, "Yesterday" for yesterday, otherwise a readable format like "Mon, Feb 10"
   - `addDays(dateStr, n)` returns the date shifted by n days in `YYYY-MM-DD` format
   - `isToday(dateStr)` returns boolean
   - Run: `npm test -- date-utils` → tests fail (module not found)

2. **GREEN** — Create `src/lib/date-utils.ts` implementing all four functions. Use plain `Date` arithmetic — no external libraries.
   - Run: `npm test -- date-utils` → tests pass

3. **REFACTOR** — Replace the local `getTodayDate()` definitions in `src/components/daily-dashboard.tsx` (line 15), `src/app/api/lumen-goals/route.ts` (line 19), and `src/components/lumen-banner.tsx` with imports from `@/lib/date-utils`. Delete the local function definitions.
   - Run: `npm test` → all tests still pass

**Notes:**
- Three files currently duplicate `getTodayDate()` — all three must be updated.
- `formatDisplayDate` is needed for the date navigation label in Task 3.

---

### Task 2: Earliest Entry Date API Endpoint

**Issue:** FOO-327
**Files:**
- `src/lib/food-log.ts` (modify — add function)
- `src/lib/__tests__/food-log.test.ts` (modify — add tests)
- `src/app/api/earliest-entry/route.ts` (create)
- `src/app/api/earliest-entry/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** — Add test in `src/lib/__tests__/food-log.test.ts` for a new function `getEarliestEntryDate(userId)` that:
   - Returns the earliest `date` value from `food_log_entries` for the given user
   - Returns `null` if the user has no entries
   - Run: `npm test -- food-log` → test fails

2. **GREEN** — Add `getEarliestEntryDate` to `src/lib/food-log.ts`. Query `food_log_entries` with `eq(userId)`, order by `date ASC`, limit 1, return the `date` field or null.
   - Run: `npm test -- food-log` → test passes

3. **RED** — Create `src/app/api/earliest-entry/__tests__/route.test.ts`:
   - GET returns `{ date: "2026-01-15" }` when entries exist
   - GET returns `{ date: null }` when no entries
   - GET returns 401 when not authenticated
   - Run: `npm test -- earliest-entry` → tests fail

4. **GREEN** — Create `src/app/api/earliest-entry/route.ts`:
   - Follow the existing pattern from `nutrition-summary/route.ts` for session validation
   - Call `getEarliestEntryDate(session!.userId)`
   - Return via `successResponse({ date })` with `Cache-Control: private, no-cache`
   - Run: `npm test -- earliest-entry` → tests pass

**Notes:**
- Follow the existing query pattern in `src/lib/food-log.ts` — the file already has `getDailyNutritionSummary` which queries by userId and date.
- Route pattern: same auth check as other API routes using `validateSession`.

---

### Task 3: DateNavigator Component

**Issue:** FOO-327
**Files:**
- `src/components/date-navigator.tsx` (create)
- `src/components/__tests__/date-navigator.test.tsx` (create)

**TDD Steps:**

1. **RED** — Create `src/components/__tests__/date-navigator.test.tsx` testing:
   - Renders the current date label using `formatDisplayDate`
   - Left arrow calls `onDateChange` with previous day
   - Right arrow calls `onDateChange` with next day
   - Right arrow is disabled when `selectedDate` equals today
   - Left arrow is disabled when `selectedDate` equals `earliestDate`
   - Shows "Today" indicator when viewing today
   - Hides "Today" indicator when viewing a past date
   - Run: `npm test -- date-navigator` → tests fail

2. **GREEN** — Create `src/components/date-navigator.tsx`:
   - Client component (`'use client'`)
   - Props: `selectedDate: string`, `onDateChange: (date: string) => void`, `earliestDate: string | null`, `isLoading?: boolean`
   - Layout: `[←] [date label] [→]` with "Today" badge
   - Use `ChevronLeft` and `ChevronRight` from `lucide-react` (already a dependency)
   - Use `addDays` and `formatDisplayDate` from `@/lib/date-utils`
   - Touch targets at least 44x44px (mobile-first per CLAUDE.md)
   - When loading, show a skeleton placeholder for the date label
   - Run: `npm test -- date-navigator` → tests pass

3. **REFACTOR** — Ensure component follows existing patterns (e.g., `className` prop support via `cn()` from `@/lib/utils`).

**Notes:**
- Reference existing component patterns in `src/components/` for styling conventions.
- No swipe gestures — arrows only per the issue spec.
- "Today" badge should be visually distinct (e.g., a small pill/chip).

---

### Task 4: Integrate Date Navigation into Dashboard

**Issue:** FOO-327
**Files:**
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify or create)

**TDD Steps:**

1. **RED** — Add/update tests in `src/components/__tests__/daily-dashboard.test.tsx`:
   - Dashboard renders the DateNavigator component
   - Fetches `/api/earliest-entry` on mount
   - SWR fetch keys include the selected date (not hardcoded today)
   - Changing the date via DateNavigator updates all fetch keys
   - When nutrition summary returns no meals for a date, shows "No food logged" empty state
   - Run: `npm test -- daily-dashboard` → tests fail

2. **GREEN** — Modify `src/components/daily-dashboard.tsx`:
   - Add `useState` for `selectedDate` initialized to `getTodayDate()`
   - Add `useSWR` call to `/api/earliest-entry` to get the boundary date
   - Replace hardcoded `today` variable in existing SWR keys with `selectedDate`
   - Render `<DateNavigator>` at the top of the dashboard, above the existing heading
   - Add empty state rendering: when `summary.meals` is empty and not loading, show a centered "No food logged" message
   - Run: `npm test -- daily-dashboard` → tests pass

3. **REFACTOR** — Clean up the component:
   - The `DashboardSkeleton` should include a skeleton placeholder for the DateNavigator area
   - Ensure the Lumen goals upload still uses the selected date (not hardcoded today)

**Notes:**
- The existing SWR calls already use a `today` variable — changing its source from `getTodayDate()` to `selectedDate` state is the core change.
- The Lumen screenshot POST also sends a `date` field in FormData — this must use `selectedDate` too.
- Empty state should only show when `!summaryLoading && summary?.meals?.length === 0`.

---

### Task 5: API Keys Database Schema

**Issue:** FOO-329
**Files:**
- `src/db/schema.ts` (modify)
- `drizzle/` (generated migration files — run `drizzle-kit generate`)

**TDD Steps:**

1. **Define schema** — Add an `apiKeys` table to `src/db/schema.ts`:
   - `id`: serial primary key
   - `userId`: uuid, FK to users.id, NOT NULL
   - `name`: text, NOT NULL (user-provided label like "My Script")
   - `keyHash`: text, NOT NULL, unique (SHA-256 hash of the raw API key)
   - `keyPrefix`: text, NOT NULL (first 8 chars of raw key, for identification in UI)
   - `lastUsedAt`: timestamp with timezone, nullable
   - `revokedAt`: timestamp with timezone, nullable
   - `createdAt`: timestamp with timezone, defaultNow, NOT NULL

2. **Generate migration** — Run `npx drizzle-kit generate` to create the SQL migration file. Do NOT hand-write migration files.

3. **Verify** — Check the generated migration SQL looks correct (CREATE TABLE with all columns, FK constraint, unique constraint on keyHash).

**Migration note:** New table only — no existing data affected. No production migration needed beyond running the migration.

**Notes:**
- Follow the existing schema patterns (see `fitbitCredentials` table for similar structure).
- `keyPrefix` allows users to identify keys in the UI without exposing the full key (e.g., "fsk_a1b2c3d4...").
- `revokedAt` is a soft-delete — revoked keys remain in the DB but are rejected during validation.
- Update CLAUDE.md DATABASE section to include `api_keys` in the tables list.

---

### Task 6: API Key Library Module

**Issue:** FOO-329
**Files:**
- `src/lib/api-keys.ts` (create)
- `src/lib/__tests__/api-keys.test.ts` (create)

**TDD Steps:**

1. **RED** — Create `src/lib/__tests__/api-keys.test.ts` with tests for:
   - `generateApiKey()` returns a string starting with `fsk_` prefix, at least 40 chars total
   - `hashApiKey(rawKey)` returns a consistent hex SHA-256 hash
   - `createApiKey(userId, name)` inserts a row into `api_keys` with hashed key and prefix, returns `{ id, name, rawKey, keyPrefix, createdAt }`
   - `listApiKeys(userId)` returns all non-revoked keys for the user (id, name, keyPrefix, createdAt, lastUsedAt) — never returns the hash
   - `revokeApiKey(userId, keyId)` sets `revokedAt` timestamp
   - `revokeApiKey` with wrong userId returns false (can't revoke another user's key)
   - `validateApiKey(rawKey)` returns `{ userId, keyId }` for valid non-revoked keys
   - `validateApiKey` returns null for revoked keys
   - `validateApiKey` returns null for non-existent keys
   - `validateApiKey` updates `lastUsedAt` on success
   - Run: `npm test -- api-keys` → tests fail

2. **GREEN** — Create `src/lib/api-keys.ts`:
   - `generateApiKey()`: Use `crypto.randomBytes(32)` to generate random bytes, encode as hex, prefix with `fsk_`
   - `hashApiKey(rawKey)`: Use `crypto.createHash('sha256').update(rawKey).digest('hex')`
   - `createApiKey(userId, name)`: Hash the key, extract prefix (first 8 chars after `fsk_`), insert into DB, return id + raw key + metadata
   - `listApiKeys(userId)`: Query `api_keys` where userId matches and revokedAt is null, return safe fields only
   - `revokeApiKey(userId, keyId)`: Update `revokedAt` where both userId and id match
   - `validateApiKey(rawKey)`: Hash the input, look up by keyHash where revokedAt is null, update lastUsedAt, return userId
   - Run: `npm test -- api-keys` → tests pass

3. **REFACTOR** — Ensure error handling follows project patterns. The raw key must never be logged (per CLAUDE.md security rules — treat like access tokens).

**Notes:**
- Follow the DB access pattern from `src/lib/food-log.ts` — import `db` from `@/db/connection` and table from `@/db/schema`.
- The `fsk_` prefix helps users identify Food Scanner API keys and avoids confusion with other services.
- `keyPrefix` stores the first 8 chars of the random portion (not including `fsk_`) for display: "fsk_a1b2c3d4..."

---

### Task 7: API Key Management Routes

**Issue:** FOO-329
**Files:**
- `src/app/api/api-keys/route.ts` (create)
- `src/app/api/api-keys/__tests__/route.test.ts` (create)
- `src/app/api/api-keys/[id]/route.ts` (create)
- `src/app/api/api-keys/[id]/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** — Create `src/app/api/api-keys/__tests__/route.test.ts`:
   - `POST /api/api-keys` with `{ name: "My Script" }` returns `{ id, name, rawKey, keyPrefix, createdAt }` with status 201
   - `POST` with missing name returns 400 VALIDATION_ERROR
   - `POST` without auth returns 401
   - `GET /api/api-keys` returns array of keys (without hashes or raw keys)
   - `GET` without auth returns 401
   - Run: `npm test -- api-keys/route` → tests fail

2. **GREEN** — Create `src/app/api/api-keys/route.ts`:
   - POST handler: validate session, parse JSON body, validate `name` is a non-empty string, call `createApiKey(userId, name)`, return via `successResponse` with status 201
   - GET handler: validate session, call `listApiKeys(userId)`, return via `successResponse` with `Cache-Control: private, no-cache`
   - Run: `npm test -- api-keys/route` → tests pass

3. **RED** — Create `src/app/api/api-keys/[id]/__tests__/route.test.ts`:
   - `DELETE /api/api-keys/[id]` returns 200 on success
   - `DELETE` with non-existent or other user's key returns 404
   - `DELETE` without auth returns 401
   - Run: `npm test -- api-keys` → tests fail

4. **GREEN** — Create `src/app/api/api-keys/[id]/route.ts`:
   - DELETE handler: validate session, extract `id` from params, call `revokeApiKey(userId, id)`, return success or 404
   - Run: `npm test -- api-keys` → tests pass

**Notes:**
- Follow existing route patterns (e.g., `food-history/[id]/route.ts` for dynamic route param extraction).
- The raw API key is only returned in the POST response — never in GET or any other endpoint.
- These routes use session auth (they're in the main `/api/` namespace, not `/api/v1/`).

---

### Task 8: API Key Settings UI

**Issue:** FOO-329
**Files:**
- `src/components/api-key-manager.tsx` (create)
- `src/components/__tests__/api-key-manager.test.tsx` (create)
- `src/app/settings/page.tsx` (modify)

**TDD Steps:**

1. **RED** — Create `src/components/__tests__/api-key-manager.test.tsx`:
   - Renders a "Generate API Key" button
   - Shows a name input when generate is clicked
   - After submitting a name, displays the raw key with a copy button and a "this will only be shown once" warning
   - After dismissing the key display, the new key appears in the list with its prefix and name
   - Each key in the list has a "Revoke" button
   - Clicking Revoke shows a confirmation, then removes the key from the list on confirm
   - Shows "No API keys" message when list is empty
   - Run: `npm test -- api-key-manager` → tests fail

2. **GREEN** — Create `src/components/api-key-manager.tsx`:
   - Client component with `useSWR` for `GET /api/api-keys`
   - "Generate" flow: name input → POST `/api/api-keys` → display raw key with copy-to-clipboard → mutate SWR cache
   - Key list: table/cards showing name, prefix (`fsk_a1b2c3d4...`), created date, last used date
   - "Revoke" flow: confirmation dialog → DELETE `/api/api-keys/[id]` → mutate SWR cache
   - Mobile-first layout with 44px touch targets
   - Run: `npm test -- api-key-manager` → tests pass

3. **Integrate** — Add `<ApiKeyManager />` to the settings page (`src/app/settings/page.tsx` or its client component). Place it in its own card/section with a heading like "API Keys".
   - Run: `npm test` → all tests pass

**Notes:**
- Follow existing component patterns in `src/components/` for styling.
- Use `navigator.clipboard.writeText()` for copy functionality.
- The raw key display should use a monospace font and a visible copy button.
- SWR mutation pattern: call `mutate('/api/api-keys')` after POST or DELETE to refresh the list.

---

### Task 9: API Key Validation for v1 Routes

**Issue:** FOO-328, FOO-329
**Files:**
- `src/lib/api-auth.ts` (create)
- `src/lib/__tests__/api-auth.test.ts` (create)

**TDD Steps:**

1. **RED** — Create `src/lib/__tests__/api-auth.test.ts`:
   - `validateApiRequest(request)` extracts `Authorization: Bearer <key>` header
   - Returns `{ userId }` for a valid key
   - Returns an error Response (401 AUTH_MISSING_SESSION) when no Authorization header
   - Returns an error Response (401 AUTH_MISSING_SESSION) when Bearer token is invalid/revoked
   - Returns an error Response (401) when Authorization header is malformed (not "Bearer ...")
   - Run: `npm test -- api-auth` → tests fail

2. **GREEN** — Create `src/lib/api-auth.ts`:
   - `validateApiRequest(request: Request)`: Extract Authorization header, parse Bearer token, call `validateApiKey(rawKey)` from `@/lib/api-keys`, return userId or error Response
   - Reuse `errorResponse` from `@/lib/api-response` for error cases
   - Run: `npm test -- api-auth` → tests pass

**Notes:**
- This is a thin wrapper that bridges the API key validation (Task 6) with the route handler pattern.
- The return signature should mirror `validateSession()` — returns `Response | null` for error/success, plus the userId on success. Or alternatively returns `{ userId } | Response` to carry the userId.
- Follow the existing `validateSession` pattern so v1 route handlers have the same ergonomics as session-based routes.

---

### Task 10: v1 Nutrition Summary and Food Log Endpoints

**Issue:** FOO-328
**Files:**
- `src/app/api/v1/nutrition-summary/route.ts` (create)
- `src/app/api/v1/nutrition-summary/__tests__/route.test.ts` (create)
- `src/app/api/v1/food-log/route.ts` (create)
- `src/app/api/v1/food-log/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** — Create `src/app/api/v1/nutrition-summary/__tests__/route.test.ts`:
   - `GET /api/v1/nutrition-summary?date=2026-02-11` with valid API key returns nutrition summary
   - Returns 400 VALIDATION_ERROR for missing/invalid date
   - Returns 401 for missing/invalid API key
   - Response format matches existing `/api/nutrition-summary` data shape
   - Run: `npm test -- v1/nutrition-summary` → tests fail

2. **GREEN** — Create `src/app/api/v1/nutrition-summary/route.ts`:
   - Use `validateApiRequest(request)` for auth
   - Validate `date` query param (same regex as existing routes)
   - Call `getDailyNutritionSummary(userId, date)` from `@/lib/food-log`
   - Return via `successResponse` with `Cache-Control: private, no-cache`
   - Run: `npm test -- v1/nutrition-summary` → tests pass

3. **RED** — Create `src/app/api/v1/food-log/__tests__/route.test.ts`:
   - `GET /api/v1/food-log?date=2026-02-11` returns food log entries for that date
   - Returns 400 for missing/invalid date
   - Returns 401 for invalid API key
   - Run: `npm test -- v1/food-log` → tests fail

4. **GREEN** — Create `src/app/api/v1/food-log/route.ts`:
   - Use `validateApiRequest` for auth
   - Validate `date` query param
   - Call the appropriate food-log lib function to get entries by date
   - Return via `successResponse`
   - Run: `npm test -- v1/food-log` → tests pass

**Notes:**
- These routes reuse existing `src/lib/food-log.ts` functions — no new business logic needed.
- The v1 routes do NOT go through the existing middleware's session check because they use API key auth instead. Update `middleware.ts` matcher to exclude `/api/v1/*` OR ensure the middleware allows requests with valid Authorization headers. The simplest approach: add `v1` to the middleware exclusion pattern alongside `health` and `auth`.

---

### Task 11: v1 Activity, Nutrition Goals, and Lumen Goals Endpoints

**Issue:** FOO-328
**Files:**
- `src/app/api/v1/activity-summary/route.ts` (create)
- `src/app/api/v1/activity-summary/__tests__/route.test.ts` (create)
- `src/app/api/v1/nutrition-goals/route.ts` (create)
- `src/app/api/v1/nutrition-goals/__tests__/route.test.ts` (create)
- `src/app/api/v1/lumen-goals/route.ts` (create)
- `src/app/api/v1/lumen-goals/__tests__/route.test.ts` (create)
- `middleware.ts` (modify — exclude v1 routes from session check)

**TDD Steps:**

1. **RED** — Create tests for `GET /api/v1/activity-summary?date=YYYY-MM-DD`:
   - Returns activity summary for valid API key and date
   - Returns 401 for invalid key
   - Returns 400 for missing date
   - Note: This endpoint needs the user's Fitbit access token. The v1 auth helper must look up the Fitbit token for the API key's userId.
   - Run: `npm test -- v1/activity-summary` → tests fail

2. **GREEN** — Create `src/app/api/v1/activity-summary/route.ts`:
   - Use `validateApiRequest` for auth
   - Look up Fitbit token for userId (use existing `getFitbitToken` from `@/lib/fitbit-token` or equivalent)
   - Return appropriate error if user has no Fitbit connection
   - Call `getActivitySummary(accessToken, date)` from `@/lib/fitbit`
   - Run: `npm test -- v1/activity-summary` → tests pass

3. **RED** — Create tests for `GET /api/v1/nutrition-goals`:
   - Returns nutrition goals for valid API key
   - No date param needed (goals are current)
   - Run: `npm test -- v1/nutrition-goals` → tests fail

4. **GREEN** — Create `src/app/api/v1/nutrition-goals/route.ts`:
   - Use `validateApiRequest` for auth
   - Reuse existing nutrition goals logic from `@/lib/fitbit`
   - Run: `npm test -- v1/nutrition-goals` → tests pass

5. **RED/GREEN** — Create `GET /api/v1/lumen-goals?date=YYYY-MM-DD`:
   - Same pattern: validate API key, validate date, call `getLumenGoalsByDate(userId, date)` from `@/lib/lumen`
   - Run: `npm test -- v1/lumen-goals` → tests pass

6. **Middleware update** — Modify `middleware.ts` config matcher to exclude `/api/v1/*` routes from session cookie checks. Update the regex pattern from `"/api/((?!health|auth).*)"` to `"/api/((?!health|auth|v1).*)"`.
   - Run: `npm test` → all tests pass

**Notes:**
- Activity summary requires Fitbit tokens — the v1 route must handle the case where the user hasn't connected Fitbit (return FITBIT_NOT_CONNECTED error).
- Nutrition goals also require Fitbit. Check the existing `/api/nutrition-goals/route.ts` for the exact pattern.
- Lumen goals only need the DB — no Fitbit dependency.

---

### Task 12: Integration & Verification

**Issue:** FOO-327, FOO-329, FOO-328
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Date navigation arrows work on the dashboard
   - [ ] Empty state shows for dates with no food logged
   - [ ] API key can be generated from settings
   - [ ] API key can be used to access v1 endpoints
   - [ ] Revoked API key is rejected
6. Update documentation:
   - [ ] Add `api_keys` to CLAUDE.md DATABASE tables list
   - [ ] Add `/api/v1/` namespace to CLAUDE.md STRUCTURE if relevant
   - [ ] Update `.env.sample` if any new env vars needed (none expected)

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move FOO-327, FOO-329, FOO-328 to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| No Authorization header on v1 route | 401 AUTH_MISSING_SESSION | Unit test |
| Invalid/revoked API key | 401 AUTH_MISSING_SESSION | Unit test |
| Missing date param | 400 VALIDATION_ERROR | Unit test |
| Invalid date format | 400 VALIDATION_ERROR | Unit test |
| No Fitbit connection (v1 activity/nutrition-goals) | 400 FITBIT_NOT_CONNECTED | Unit test |
| No food entries for date (dashboard) | "No food logged" empty state | Component test |
| No food entries for user (earliest-entry) | `{ date: null }`, left arrow disabled | Unit + component test |

## Risks & Open Questions

- [ ] Rate limiting for v1 endpoints: The existing session-based routes have rate limiting (e.g., 30 req/15min for analyze-food). Should v1 endpoints also be rate-limited? Suggest adding basic rate limiting per API key in a future iteration — not blocking for initial release.
- [ ] API key limit per user: Should there be a max number of API keys per user? Suggest a reasonable limit (e.g., 10) to prevent abuse, but this is a single-user app so low risk. Can defer.

## Scope Boundaries

**In Scope:**
- Date navigation UI on daily dashboard (FOO-327)
- API key auth system: schema, generation, validation, settings UI (FOO-329)
- Read-only v1 API endpoints for external access (FOO-328)
- Middleware update to exclude v1 routes from session check

**Out of Scope:**
- Swipe gestures for date navigation (explicitly excluded in FOO-327)
- URL query params for date (explicitly excluded — client state only)
- Write endpoints in v1 (e.g., logging food via API) — not in FOO-328 scope
- Rate limiting for v1 endpoints — future iteration
- API key rotation/regeneration — not in current scope

---

## Iteration 1

**Implemented:** 2026-02-11
**Method:** Agent team (3 workers)

### Tasks Completed This Iteration
- Task 1: Extract Date Utility Module (FOO-327) — Created `date-utils.ts` with getTodayDate, formatDisplayDate, addDays, isToday; replaced 3 duplicated definitions (worker-1)
- Task 2: Earliest Entry Date API Endpoint (FOO-327) — Added getEarliestEntryDate to food-log.ts; created GET /api/earliest-entry route (worker-1)
- Task 3: DateNavigator Component (FOO-327) — Created client component with left/right arrows, date label, disabled states at boundaries, skeleton loading (worker-1)
- Task 4: Integrate Date Navigation into Dashboard (FOO-327) — Added selectedDate state, DateNavigator, empty state, replaced hardcoded today with date-utils (worker-1)
- Task 5: API Keys Database Schema (FOO-329) — Added apiKeys table to schema.ts; drizzle-kit generate run by lead (worker-2 + lead)
- Task 6: API Key Library Module (FOO-329) — Created api-keys.ts with generateApiKey, hashApiKey, createApiKey, listApiKeys, revokeApiKey, validateApiKey (worker-2)
- Task 7: API Key Management Routes (FOO-329) — Created GET/POST /api/api-keys and DELETE /api/api-keys/[id] routes (worker-2)
- Task 8: API Key Settings UI (FOO-329) — Created ApiKeyManager component with generate/copy/revoke flows, integrated into settings page (worker-2)
- Task 9: API Key Validation for v1 Routes (FOO-328) — Created api-auth.ts with validateApiRequest for Bearer token auth (worker-3)
- Task 10: v1 Nutrition Summary and Food Log Endpoints (FOO-328) — Created GET /api/v1/nutrition-summary and /api/v1/food-log (worker-3)
- Task 11: v1 Activity, Nutrition Goals, and Lumen Goals Endpoints (FOO-328) — Created 3 v1 endpoints + middleware exclusion for /api/v1/* (worker-3)
- Task 12: Integration & Verification — Lead ran full verification, fixed lint/type issues, updated CLAUDE.md

### Files Modified
- `src/lib/date-utils.ts` — Created: shared date utility (getTodayDate, formatDisplayDate, addDays, isToday)
- `src/lib/__tests__/date-utils.test.ts` — Created: 15 tests for date utilities
- `src/components/date-navigator.tsx` — Created: date navigation component with arrows and boundary logic
- `src/components/__tests__/date-navigator.test.tsx` — Created: 10 tests for DateNavigator
- `src/app/api/earliest-entry/route.ts` — Created: GET endpoint for earliest food log date
- `src/app/api/earliest-entry/__tests__/route.test.ts` — Created: 4 tests for earliest-entry route
- `src/lib/food-log.ts` — Modified: added getEarliestEntryDate function
- `src/lib/__tests__/food-log.test.ts` — Modified: added 3 tests for getEarliestEntryDate
- `src/components/daily-dashboard.tsx` — Modified: added selectedDate state, DateNavigator, empty state, date-utils imports
- `src/components/__tests__/daily-dashboard.test.tsx` — Modified: updated to 32 tests covering date navigation
- `src/app/api/lumen-goals/route.ts` — Modified: replaced local getTodayDate with date-utils import
- `src/components/lumen-banner.tsx` — Modified: replaced local getTodayDate with date-utils import
- `src/db/schema.ts` — Modified: added apiKeys table
- `drizzle/0011_eager_the_captain.sql` — Generated: CREATE TABLE api_keys migration
- `src/lib/api-keys.ts` — Created: API key generation, hashing, CRUD, validation
- `src/lib/__tests__/api-keys.test.ts` — Created: 14 tests for API key module
- `src/app/api/api-keys/route.ts` — Created: GET/POST routes for API key management
- `src/app/api/api-keys/__tests__/route.test.ts` — Created: 9 tests
- `src/app/api/api-keys/[id]/route.ts` — Created: DELETE route for key revocation
- `src/app/api/api-keys/[id]/__tests__/route.test.ts` — Created: 4 tests
- `src/components/api-key-manager.tsx` — Created: API key management UI with generate/copy/revoke
- `src/components/__tests__/api-key-manager.test.tsx` — Created: 10 tests
- `src/components/ui/card.tsx` — Created: shadcn/ui Card component
- `src/app/settings/page.tsx` — Modified: integrated ApiKeyManager component
- `src/lib/api-auth.ts` — Created: validateApiRequest for Bearer token auth
- `src/lib/__tests__/api-auth.test.ts` — Created: 5 tests
- `src/app/api/v1/nutrition-summary/route.ts` — Created: v1 nutrition summary endpoint
- `src/app/api/v1/nutrition-summary/__tests__/route.test.ts` — Created: 6 tests
- `src/app/api/v1/food-log/route.ts` — Created: v1 food log endpoint
- `src/app/api/v1/food-log/__tests__/route.test.ts` — Created: 6 tests
- `src/app/api/v1/activity-summary/route.ts` — Created: v1 activity summary endpoint
- `src/app/api/v1/activity-summary/__tests__/route.test.ts` — Created: 9 tests
- `src/app/api/v1/nutrition-goals/route.ts` — Created: v1 nutrition goals endpoint
- `src/app/api/v1/nutrition-goals/__tests__/route.test.ts` — Created: 7 tests
- `src/app/api/v1/lumen-goals/route.ts` — Created: v1 lumen goals endpoint
- `src/app/api/v1/lumen-goals/__tests__/route.test.ts` — Created: 6 tests
- `middleware.ts` — Modified: excluded /api/v1/* from session check
- `CLAUDE.md` — Modified: added api_keys to DATABASE tables list

### Linear Updates
- FOO-327: Todo → In Progress → Review
- FOO-329: Todo → In Progress → Review
- FOO-328: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 5 issues (1 false positive logging concern, 3 real fixes applied: error handling in ApiKeyManager, duplicate Today badge, CLAUDE.md update, 1 medium clipboard error handling)
- verifier: All 1369 tests pass, zero lint warnings, zero typecheck errors, clean build

### Work Partition
- Worker 1: Tasks 1-4 (FOO-327 — date navigation: date-utils, earliest-entry, DateNavigator, dashboard integration)
- Worker 2: Tasks 5-8 (FOO-329 — API keys: schema, lib module, routes, settings UI)
- Worker 3: Tasks 9-11 (FOO-328 — v1 API: api-auth, nutrition/food-log endpoints, activity/goals/middleware)
- Lead: Task 5 drizzle-kit generate, Task 12 verification, all post-verification fixes

### Continuation Status
All tasks completed.
