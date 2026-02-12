# Fix Plan: Claude usage route uses wrong auth mechanism

**Issue:** FOO-335
**Date:** 2026-02-12
**Status:** COMPLETE
**Branch:** fix/FOO-335-claude-usage-auth

## Investigation

### Bug Report
Settings page shows "Failed to load usage data" for the Claude API Usage section. Food scanning works and records usage to the DB, but the read route always returns 401.

### Classification
- **Type:** Auth Issue
- **Severity:** High
- **Affected Area:** `/api/claude-usage` route + Settings page

### Root Cause Analysis
The `/api/claude-usage` route was implemented with API key auth (`validateApiRequest` from `@/lib/api-auth`) instead of session auth (`getSession` + `validateSession` from `@/lib/session`). The client component calls it via `useSWR("/api/claude-usage", apiFetcher)` — a plain browser `fetch()` with no Bearer token, so every request fails with 401.

#### Evidence
- **File:** `src/app/api/claude-usage/route.ts:1,7` — imports and calls `validateApiRequest` instead of `getSession`/`validateSession`
- **Staging logs:** 8 occurrences of `[WARN] missing Authorization header action="api_auth_missing_header"` followed by `[WARN] api response error errorCode="AUTH_MISSING_SESSION" status=401` at 15:43, 15:44, 15:55 UTC on 2026-02-12
- **Convention violation:** Every other non-v1 browser-facing route (17 routes) uses `getSession()` + `validateSession()`. Only `/api/v1/*` routes use `validateApiRequest()`. This is the only non-v1 route using API key auth.

#### Related Code
- `src/app/api/claude-usage/route.ts:1,7` — wrong auth import and call
- `src/app/api/claude-usage/__tests__/route.test.ts:5-8` — test mocks `validateApiRequest` instead of session
- `src/components/claude-usage-section.tsx:42-48` — error state shows vague "Failed to load usage data" message
- `src/app/api/nutrition-summary/route.ts:1,14-18` — reference: correct session auth pattern for browser-facing route
- `src/app/api/nutrition-summary/__tests__/route.test.ts:6-30` — reference: correct session auth test mock pattern

### Impact
- Users see "Failed to load usage data" on Settings page — feature is completely broken
- Data IS being written to `claude_usage` table but can never be read through the UI
- No data loss — all usage records are safely stored

## Fix Plan (TDD Approach)

### Step 1: Fix route auth from API key to session

**File:** `src/app/api/claude-usage/route.ts` (modify)
**Test:** `src/app/api/claude-usage/__tests__/route.test.ts` (modify)
**Pattern:** Follow `src/app/api/nutrition-summary/route.ts` and its test file for the session auth pattern

**Behavior:**
- Replace `validateApiRequest` import with `getSession` + `validateSession` from `@/lib/session`
- Auth check: `const session = await getSession()` then `const validationError = validateSession(session); if (validationError) return validationError;`
- Use `session!.userId` (after validation) instead of `authResult.userId`
- Remove the `request` parameter from GET since `getSession()` reads from cookies (doesn't need the request object). Keep `request` only for the URL searchParams parsing.

**Tests:**
1. Replace `mockValidateApiRequest` mock with `mockGetSession` + inline `validateSession` mock (copy pattern from `src/app/api/nutrition-summary/__tests__/route.test.ts:6-30`)
2. Update "returns 401 if no session" test to use `mockGetSession.mockResolvedValue(null)` instead of returning a Response
3. Update all success-path tests to use `mockGetSession.mockResolvedValue({ userId: "user-123" })` instead of `mockValidateApiRequest.mockResolvedValue({ userId: "user-123" })`
4. Verify `mockGetSession` is called (not `mockValidateApiRequest`)

### Step 2: Improve error message in component

**File:** `src/components/claude-usage-section.tsx` (modify)
**Test:** `src/components/__tests__/claude-usage-section.test.tsx` (modify)

**Behavior:**
- When SWR returns an error, show a more descriptive message that includes the error details
- Display: "Unable to load usage data. Please try again later." as the primary message
- Below it, show the actual error in smaller muted text: e.g., `error.message` from the SWR error object
- This helps debugging without exposing raw internals to the user

**Tests:**
1. Add test: when SWR returns an error with message "Not authenticated", renders "Unable to load usage data" text and shows the error detail
2. Add test: when SWR returns an error with message "HTTP 500", renders the error detail text

### Step 3: Add API route auth convention to CLAUDE.md

**File:** `CLAUDE.md` (modify)

**Behavior:**
- Add a new section under SECURITY (or as a subsection) documenting the auth convention:
  - `src/app/api/*` browser-facing routes: use `getSession()` + `validateSession()` from `@/lib/session` — auth is via iron-session cookies
  - `src/app/api/v1/*` external API routes: use `validateApiRequest()` from `@/lib/api-auth` — auth is via Bearer API key
  - `src/app/api/auth/*` routes: have their own OAuth/session management logic
  - `src/app/api/health` route: public, no auth
- This convention must be explicitly documented so future features don't repeat this mistake

### Step 4: Verify

- [ ] All new tests pass
- [ ] All existing tests pass
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Build succeeds
- [ ] Settings page loads Claude API usage data (manual verification on staging)

## Notes
- The original PLANS.md that created this route (FOO-334, Task 6) instructed workers to "Follow pattern from existing API routes (e.g., `src/app/api/v1/food-log/route.ts`)" — the worker followed a v1 route pattern instead of a browser-facing route pattern, causing the auth mismatch.
- No migration needed — this is a code-only fix.

---

## Iteration 1

**Implemented:** 2026-02-12
**Method:** Single-agent (team workers exited without implementing)

### Tasks Completed This Iteration
- Step 1: Fix route auth from API key to session (lead — single-agent)
- Step 2: Improve error message in component (worker-2 completed before exit)
- Step 3: Add API route auth convention to CLAUDE.md (lead — single-agent)

### Files Modified
- `src/app/api/claude-usage/route.ts` — Replaced `validateApiRequest` with `getSession` + `validateSession`
- `src/app/api/claude-usage/__tests__/route.test.ts` — Updated mocks from API key auth to session auth pattern
- `src/components/claude-usage-section.tsx` — Changed error text to "Unable to load usage data" with error detail
- `src/components/__tests__/claude-usage-section.test.tsx` — Added 2 error state tests
- `CLAUDE.md` — Added API route auth convention under SECURITY section

### Linear Updates
- FOO-335: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: 3 findings, all false positives (patterns match established nutrition-summary convention)
- verifier: All 1423 tests pass, zero warnings

### Review Findings

Files reviewed: 5
Reviewers: security, reliability, quality (agent team)
Checks applied: Security (OWASP), Auth, Logic, Async, Resources, Type Safety, Conventions, Test Quality

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- FOO-335: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. FOO-335 moved to Merge.
