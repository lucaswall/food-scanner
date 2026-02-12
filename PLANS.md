# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-332-refresh-guard-and-usage-tracking
**Issues:** FOO-332, FOO-334
**Created:** 2026-02-12
**Last Updated:** 2026-02-12

## Summary

Two independent features: (1) a global app refresh guard that forces a full page reload when reopening the PWA after overnight sleep, and (2) a Claude API usage tracking system that records token consumption per call and displays monthly cost summaries on the Settings page.

## Issues

### FOO-332: Force full page reload on morning app reopen

**Priority:** Medium
**Labels:** Improvement
**Description:** When reopening the app after sleeping (e.g., next morning), stale data persists. The existing 1-hour soft reset in `DailyDashboard` (FOO-333) only revalidates SWR caches on the Home route. This issue adds a separate, global guard that forces a hard navigation to `/app` when both conditions are met: 4+ hours elapsed AND a new calendar day has started.

**Acceptance Criteria:**
- [ ] When the app becomes visible after being hidden for 4+ hours AND a new calendar day has started, force a full page reload navigating to `/app`
- [ ] Works regardless of which route the user is on (Home, Quick Select, Analyze, History, Settings)
- [ ] Uses `window.location.href = '/app'` (full page load — clears all client state)
- [ ] The existing 1-hour soft reset in DailyDashboard (FOO-333) is preserved unchanged
- [ ] Condition: both 4+ hours elapsed AND midnight crossed (not either/or)

### FOO-334: Track monthly Claude API token usage and cost

**Priority:** Medium
**Labels:** Feature
**Description:** The app uses Claude API for food analysis (Sonnet) and Lumen parsing (Haiku) but has no visibility into token usage or cost. This adds a `claude_usage` DB table, captures `response.usage` after every API call, and displays monthly cost summaries on the Settings page.

**Acceptance Criteria:**
- [ ] Every Claude API call stores a transaction record: model, input/output/cache tokens, per-token prices at time of request, computed dollar cost, timestamp
- [ ] Settings page shows a "Claude API Usage" section with current month + 2 previous months
- [ ] Each month displays: total requests, total tokens (input/output), total dollar cost
- [ ] Per-model pricing stored alongside each transaction for historical accuracy
- [ ] Per-model pricing configurable as code constants (updated when Anthropic changes prices)

## Prerequisites

- [ ] On `main` branch, clean working tree
- [ ] `npm install` up to date
- [ ] Existing tests passing

## Implementation Tasks

### Task 1: Create AppRefreshGuard component

**Issue:** FOO-332
**Files:**
- `src/components/app-refresh-guard.tsx` (create)
- `src/components/__tests__/app-refresh-guard.test.tsx` (create)

**TDD Steps:**

1. **RED** — Write test file covering these scenarios:
   - Does NOT reload when elapsed < 4 hours (even if date changed)
   - Does NOT reload when date has NOT changed (even if 5 hours elapsed)
   - DOES reload when both conditions met: 4+ hours AND new date
   - Renders children when no reload needed
   - Stores `lastActive` timestamp and date string in localStorage on `visibilitychange` → hidden
   - Reads `lastActive` from localStorage on `visibilitychange` → visible
   - On mount (first load), initializes localStorage with current timestamp/date
   - Test approach:
     - Mock `localStorage` (JSDOM provides it, use `vi.spyOn(Storage.prototype, ...)` if needed)
     - Mock `Date.now()` with `vi.useFakeTimers()` + `vi.setSystemTime()`
     - Mock `window.location` by defining `delete (window as any).location; window.location = { href: '' } as any` pattern, or use `Object.defineProperty`
     - Dispatch `new Event('visibilitychange')` after setting `document.visibilityState` via `Object.defineProperty`
   - Run: `npm test -- app-refresh-guard`
   - Verify: Tests fail (component doesn't exist)

2. **GREEN** — Create `src/components/app-refresh-guard.tsx`:
   - `'use client'` component accepting `{ children: React.ReactNode }`
   - localStorage keys: `app-refresh-guard:lastActive` (timestamp), `app-refresh-guard:lastDate` (date string from `new Date().toDateString()`)
   - On mount: write current timestamp and date string to localStorage
   - On `visibilitychange` → hidden: update localStorage with current values
   - On `visibilitychange` → visible: read stored values, check both conditions:
     - `Date.now() - storedTimestamp > 4 * 60 * 60 * 1000` (4 hours)
     - `new Date().toDateString() !== storedDateString` (date changed)
   - If both true: `window.location.href = '/app'`
   - Return `<>{children}</>` (no wrapper DOM)
   - Run: `npm test -- app-refresh-guard`
   - Verify: Tests pass

3. **REFACTOR** — Ensure constants (4h threshold, localStorage keys) are named, not magic numbers.

**Notes:**
- This is intentionally separate from the existing DailyDashboard soft reset — different thresholds, different scope, different mechanism.
- Follow pattern from `src/components/daily-dashboard.tsx` lines 56-85 for the `visibilitychange` listener setup, but use localStorage instead of refs (refs don't survive page reloads).

### Task 2: Integrate AppRefreshGuard into app layout

**Issue:** FOO-332
**Files:**
- `src/app/app/layout.tsx` (modify)

**TDD Steps:**

1. **RED** — This is a wiring task. No new unit tests needed — the guard component is already tested. Verify manually that the layout still renders.

2. **GREEN** — Modify `src/app/app/layout.tsx`:
   - Keep it as a server component (no `'use client'`)
   - Import `AppRefreshGuard` from `@/components/app-refresh-guard`
   - Wrap `{children}` inside `<AppRefreshGuard>` (inside the existing `<div className="pb-20">`)
   - Current layout structure:
     ```
     <div className="pb-20">{children}</div>
     <BottomNav />
     ```
   - After:
     ```
     <AppRefreshGuard>
       <div className="pb-20">{children}</div>
       <BottomNav />
     </AppRefreshGuard>
     ```
   - Wrap both children AND BottomNav so the guard covers all rendered content on every /app/* route

3. **REFACTOR** — None expected.

**Notes:**
- Server Components can render Client Components as children. The layout stays a server component; `AppRefreshGuard` is a client component that receives `children` as a prop.

### Task 3: Add claude_usage table to schema and types

**Issue:** FOO-334
**Files:**
- `src/db/schema.ts` (modify)
- `src/types/index.ts` (modify)

**TDD Steps:**

1. **RED** — No test-first step for schema/type definitions. These are validated at compile time by TypeScript.

2. **GREEN** — Add to `src/db/schema.ts` after the `apiKeys` table:
   - New `claudeUsage` table with columns:
     - `id` — serial primary key
     - `userId` — uuid FK to users.id
     - `model` — text, not null (e.g., "claude-sonnet-4-20250514")
     - `operation` — text, not null (e.g., "food-analysis", "food-refinement", "lumen-parsing")
     - `inputTokens` — integer, not null
     - `outputTokens` — integer, not null
     - `cacheCreationTokens` — integer (nullable, defaults to 0 if not present)
     - `cacheReadTokens` — integer (nullable, defaults to 0 if not present)
     - `inputPricePerMToken` — numeric, not null (price per 1M tokens at time of request, stored as string via Drizzle numeric)
     - `outputPricePerMToken` — numeric, not null
     - `costUsd` — numeric, not null (pre-computed total cost for this call)
     - `createdAt` — timestamp with timezone, default now, not null

   Add to `src/types/index.ts`:
   - `ClaudeUsageRecord` interface: `{ id: number; model: string; operation: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; costUsd: string; createdAt: string }`
   - `MonthlyClaudeUsage` interface: `{ month: string; totalRequests: number; totalInputTokens: number; totalOutputTokens: number; totalCostUsd: string }`
   - `ClaudeUsageResponse` interface: `{ months: MonthlyClaudeUsage[] }`

3. **REFACTOR** — None expected.

**Migration note:** New table only (no data migration needed). Run `npx drizzle-kit generate` after this task.

### Task 4: Create claude-usage lib module

**Issue:** FOO-334
**Files:**
- `src/lib/claude-usage.ts` (create)
- `src/lib/__tests__/claude-usage.test.ts` (create)

**TDD Steps:**

1. **RED** — Write tests for:
   - `MODEL_PRICING` constant: verify it exports pricing for both `claude-sonnet-4-20250514` and `claude-haiku-4-5-20251001`; each entry has `inputPricePerMToken` and `outputPricePerMToken` as numbers
   - `computeCost(usage, pricing)` pure function:
     - Input: `{ inputTokens, outputTokens, cacheCreationTokens?, cacheReadTokens? }` and `{ inputPricePerMToken, outputPricePerMToken }`
     - Returns cost as string with 6 decimal places
     - Test case: 1000 input tokens at $3/M input + 500 output tokens at $15/M output = $0.010500
     - Test case: zero tokens = "0.000000"
     - Cache tokens: `cacheCreationTokens` are charged at input price (they ARE input tokens), `cacheReadTokens` are charged at 10% of input price (Anthropic's standard discount) — adjust these based on actual Anthropic pricing
   - `recordUsage(userId, model, operation, usage)` function:
     - Mock the DB insert
     - Verify it calls insert with correct computed cost
     - Verify it looks up pricing from MODEL_PRICING by model name
     - Verify it doesn't throw on unknown model (logs warning, uses zero pricing)
   - `getMonthlyUsage(userId, months)` function:
     - Mock the DB query
     - Returns array of `MonthlyClaudeUsage` objects, one per month
     - Months are ordered most-recent-first
     - Empty months are included with zero values
   - Run: `npm test -- claude-usage`
   - Verify: Tests fail

2. **GREEN** — Create `src/lib/claude-usage.ts`:
   - Export `MODEL_PRICING` as a `Record<string, { inputPricePerMToken: number; outputPricePerMToken: number }>` with current Anthropic prices:
     - Sonnet 4: input $3/M, output $15/M
     - Haiku 4.5: input $0.80/M, output $4/M
   - Export `computeCost()` pure function — arithmetic on token counts and per-M prices
   - Export `recordUsage()` — looks up pricing, computes cost, inserts row into `claudeUsage` table. Fire-and-forget (catch + log errors, never throw — usage tracking must not break food analysis)
   - Export `getMonthlyUsage()` — SQL aggregation query grouping by `date_trunc('month', created_at)`, returning totals for the last N months. Use Drizzle's `sql` template for the aggregation.
   - Follow DB access patterns from `src/lib/food-log.ts` and `src/lib/api-keys.ts`
   - Run: `npm test -- claude-usage`
   - Verify: Tests pass

3. **REFACTOR** — Extract pricing lookup into a small helper if it's repeated.

**Notes:**
- `recordUsage` must be fire-and-forget: `recordUsage(...).catch(err => logger.error(...))`. It should never cause a food analysis or Lumen parse to fail.
- Reference `src/lib/api-keys.ts` for the DB access pattern (import `db` from `@/db/connection`, import schema from `@/db/schema`).
- Cache token pricing: Anthropic charges cache_creation at 25% MORE than input price, and cache_read at 90% LESS than input price. Verify current pricing at time of implementation and encode in MODEL_PRICING.

### Task 5: Capture usage in claude.ts and lumen.ts

**Issue:** FOO-334
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/lumen.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify — if exists)
- `src/lib/__tests__/lumen.test.ts` (modify — if exists)

**TDD Steps:**

1. **RED** — Add/update tests:
   - For `analyzeFood()`: verify that after a successful API response, `recordUsage` is called with userId, model name, `"food-analysis"` operation, and the response's usage object
   - For `refineAnalysis()`: same but with `"food-refinement"` operation
   - For `parseLumenScreenshot()`: same but with `"lumen-parsing"` operation and Haiku model
   - Mock `recordUsage` as a vi.mock of `@/lib/claude-usage`
   - Verify `recordUsage` is NOT awaited (fire-and-forget)
   - Verify that if `recordUsage` throws, the main function still returns successfully
   - Run: `npm test -- claude` and `npm test -- lumen`
   - Verify: New assertions fail

2. **GREEN** — Modify both files:
   - `src/lib/claude.ts`: Both `analyzeFood()` and `refineAnalysis()` need a `userId` parameter added. After the successful `response` from the Anthropic SDK, call `recordUsage(userId, response.model, operation, response.usage).catch(...)` — fire-and-forget. The `response.usage` object from the Anthropic SDK has `{ input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens? }`.
   - `src/lib/lumen.ts`: `parseLumenScreenshot()` needs a `userId` parameter. Same fire-and-forget pattern.
   - Update all callers of these functions to pass `userId`. Check the route handlers that call `analyzeFood`, `refineAnalysis`, and `parseLumenScreenshot` — they already have the session with userId available.
   - Run: `npm test -- claude` and `npm test -- lumen`
   - Verify: Tests pass

3. **REFACTOR** — None expected.

**Notes:**
- The `userId` parameter addition will require updating the call sites in the route handlers. Check `src/app/api/` for routes that call these functions and pass the userId from the session.
- The Anthropic SDK `Message` type includes `usage: { input_tokens: number; output_tokens: number }` plus optional cache fields. Type the `usage` parameter in `recordUsage` to match.

### Task 6: Create GET /api/claude-usage route

**Issue:** FOO-334
**Files:**
- `src/app/api/claude-usage/route.ts` (create)
- `src/app/api/claude-usage/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** — Write route tests:
   - Returns 401 if no session
   - Returns monthly usage data for default 3 months
   - Supports `?months=N` query param (max 12)
   - Response matches `ApiSuccessResponse<ClaudeUsageResponse>` format
   - Sets `Cache-Control: private, no-cache` header
   - Run: `npm test -- claude-usage/route` (or appropriate pattern)
   - Verify: Tests fail

2. **GREEN** — Create the route:
   - Follow pattern from existing API routes (e.g., `src/app/api/v1/food-log/route.ts`)
   - Auth check via `getSession()`
   - Parse `months` from searchParams (default 3, clamp to 1-12)
   - Call `getMonthlyUsage(session.userId, months)`
   - Return with `successResponse()` from `@/lib/api-response`
   - Set `Cache-Control: private, no-cache`
   - Run: `npm test -- claude-usage`
   - Verify: Tests pass

3. **REFACTOR** — None expected.

**Notes:**
- Reference `src/app/api/v1/food-log/route.ts` for the standard API route pattern (session check, response format, cache headers).

### Task 7: Create ClaudeUsageSection component and add to Settings

**Issue:** FOO-334
**Files:**
- `src/components/claude-usage-section.tsx` (create)
- `src/components/__tests__/claude-usage-section.test.tsx` (create)
- `src/app/settings/page.tsx` (modify)

**TDD Steps:**

1. **RED** — Write component tests:
   - Shows loading skeleton while fetching
   - Shows "No usage data" when API returns empty months array
   - Renders month rows with formatted totals (requests, tokens, cost)
   - Formats cost as USD with 2 decimal places (e.g., "$1.23")
   - Formats token counts with comma separators (e.g., "1,234,567")
   - Most recent month displayed first
   - Uses SWR with `apiFetcher` pattern (mock via `useSWR`)
   - Run: `npm test -- claude-usage-section`
   - Verify: Tests fail

2. **GREEN** — Create the component:
   - `'use client'` component
   - Uses `useSWR<ClaudeUsageResponse>("/api/claude-usage", apiFetcher)`
   - Card layout matching existing Settings sections (rounded-xl border bg-card p-6)
   - Header: "Claude API Usage"
   - For each month: show month name (e.g., "February 2026"), request count, total tokens, total cost
   - Compact table or stacked layout for mobile-first display
   - Loading state: Skeleton placeholders matching the data layout

   Modify `src/app/settings/page.tsx`:
   - Import `ClaudeUsageSection`
   - Add it between `SettingsContent` and `ApiKeyManager` (or after ApiKeyManager — user's choice at implementation)

3. **REFACTOR** — Extract currency/number formatters if useful.

**Notes:**
- Follow the card styling from `src/components/settings-content.tsx` Appearance section (lines 284-318): `rounded-xl border bg-card p-6`.
- Mobile-first: stack month summaries vertically, avoid horizontal scroll.
- Touch targets: any interactive elements must be at least 44x44px.

### Task 8: Generate Drizzle migration and integration verification

**Issue:** FOO-334
**Files:**
- `drizzle/` (generated files — do NOT hand-write)
- `MIGRATIONS.md` (modify)

**Steps:**

1. Run `npx drizzle-kit generate` to create the migration for the new `claude_usage` table
2. Verify the generated SQL creates the table with all expected columns
3. Run full test suite: `npm test`
4. Run linter: `npm run lint`
5. Run type checker: `npm run typecheck`
6. Run build: `npm run build`
7. Log in `MIGRATIONS.md`: "New `claude_usage` table — no data migration needed, new table only."

**Migration note:** New table only. No existing data affected. The migration is a simple CREATE TABLE.

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move FOO-332 and FOO-334 to "In Progress" when starting |
| Linear | `update_issue` | Move to "Done" when implementation complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| localStorage unavailable | Guard does nothing (no crash) | Unit test |
| Unknown Claude model in recordUsage | Log warning, use zero pricing | Unit test |
| DB insert fails in recordUsage | Log error, don't throw (fire-and-forget) | Unit test |
| No session on /api/claude-usage | Return 401 | Unit test |
| Invalid months param | Clamp to 1-12 | Unit test |

## Risks & Open Questions

- [ ] Anthropic SDK cache token fields: verify exact field names (`cache_creation_input_tokens` vs `cache_creation_tokens`) at implementation time by checking SDK types
- [ ] Anthropic pricing for cache tokens: verify current cache_creation and cache_read pricing multipliers relative to base input price
- [ ] `userId` parameter addition to `analyzeFood`/`refineAnalysis`/`parseLumenScreenshot` requires updating all call sites — check all route handlers

## Scope Boundaries

**In Scope:**
- AppRefreshGuard component with 4h + midnight condition
- Integration into app layout for all /app/* routes
- claude_usage DB table and Drizzle migration
- Usage recording in claude.ts and lumen.ts
- Monthly usage API endpoint
- Settings page usage display section

**Out of Scope:**
- Modifying the existing 1-hour DailyDashboard soft reset (FOO-333)
- Real-time usage alerts or budget limits
- Per-endpoint usage breakdown beyond model/operation
- Usage export or reporting features
- Service worker or push notification integration
