# Fix Plan: Protected pages render without valid DB session

**Issue:** FOO-155
**Date:** 2026-02-06
**Status:** Planning
**Branch:** fix/FOO-155-session-validation-on-pages

## Investigation

### Bug Report
After migrating sessions to PostgreSQL, user remains "logged in" when refreshing the webapp despite the sessions table being empty. The old iron-session cookie (containing the pre-migration full session data) passes middleware because middleware only checks cookie existence. Protected pages render without validating the session against the DB.

### Classification
- **Type:** Auth Issue / Security
- **Severity:** Critical
- **Affected Area:** All protected pages (`/app`, `/settings`) and logout endpoint

### Root Cause Analysis

The middleware at `middleware.ts:8` is a fast-path cookie-existence check:
```typescript
if (!sessionCookie || !sessionCookie.value?.trim()) { /* deny */ }
```
This is acceptable **only if every protected route validates `getSession()` at the route level**. Three routes violate this contract:

#### Evidence

1. **`src/app/app/page.tsx:8-30`** — CRITICAL
   - Calls `getSession()` but never checks if result is `null`
   - Renders `<FoodAnalyzer />` (the entire app UI) regardless
   - `{session?.email}` silently renders empty string on null session

2. **`src/app/api/auth/logout/route.ts:5-15`** — MODERATE
   - No session validation; always returns `200 { success: true }`
   - Test at line 45-52 explicitly asserts this broken behavior: "returns success even when no session exists"

3. **`src/app/settings/page.tsx:25-133`** — MODERATE
   - Client component with SWR fetch to `/api/auth/session`
   - Full page shell (including "Reconnect Fitbit" form, "Logout" button) renders before auth check completes
   - On auth failure, shows error text but does NOT redirect to login

### Impact
- User sees full protected UI without valid authentication
- FoodAnalyzer component mounts and is interactive (API calls from it would fail with 401, but UI exposure is the issue)
- Settings page shows action buttons (Reconnect Fitbit, Logout) before validating session
- Logout endpoint callable without authentication (low impact but violates API contract)

## Fix Plan (TDD Approach)

### Step 1: Fix `/app` page — add redirect on null session

#### 1a: Write failing test

**File:** `src/app/app/__tests__/page.test.tsx`

Add test that verifies `redirect("/")` is called when `getSession()` returns null:

```typescript
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

it("redirects to / when session is null", async () => {
  mockGetSession.mockResolvedValue(null);
  await AppPage();
  expect(redirect).toHaveBeenCalledWith("/");
});
```

#### 1b: Implement fix

**File:** `src/app/app/page.tsx`

Add `redirect` import and null check:

```typescript
import { redirect } from "next/navigation";

export default async function AppPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  // ... rest of component (session is now guaranteed non-null)
}
```

After the fix, remove optional chaining on `session?.email` since session is guaranteed non-null after the guard.

### Step 2: Fix `/api/auth/logout` — require valid session

#### 2a: Write failing test / update existing

**File:** `src/app/api/auth/logout/__tests__/route.test.ts`

Change the existing "returns success even when no session exists" test to expect 401:

```typescript
it("returns 401 when no session exists", async () => {
  mockGetSession.mockResolvedValue(null);
  const response = await POST();
  expect(response.status).toBe(401);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.error.code).toBe("AUTH_MISSING_SESSION");
});
```

#### 2b: Implement fix

**File:** `src/app/api/auth/logout/route.ts`

Add `validateSession` import and check:

```typescript
import { getSession, validateSession } from "@/lib/session";

export async function POST() {
  const session = await getSession();
  const validationError = validateSession(session);
  if (validationError) return validationError;

  await session!.destroy();

  logger.info({ action: "logout" }, "user logged out");
  return successResponse({ message: "Logged out" });
}
```

### Step 3: Fix `/settings` page — convert to server component with redirect

#### 3a: Write failing test

**File:** `src/app/settings/__tests__/page.test.tsx`

The settings page needs a fundamental redesign: convert from client component to a server component wrapper that validates the session and redirects, with the client UI as a child. However, to keep the change minimal and focused on security:

**Option chosen:** Add a server-component wrapper (`settings/page.tsx` becomes server component) that validates session and redirects. Extract the current client UI into a `settings-content.tsx` client component.

New test for server wrapper:

```typescript
// In a new describe block or updated test file
it("redirects to / when session is null", async () => {
  mockGetSession.mockResolvedValue(null);
  await SettingsPage();
  expect(redirect).toHaveBeenCalledWith("/");
});
```

#### 3b: Implement fix

**File:** `src/app/settings/page.tsx` — becomes server component wrapper:

```typescript
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SettingsContent } from "@/components/settings-content";

export default async function SettingsPage() {
  const session = await getSession();

  if (!session) {
    redirect("/");
  }

  return <SettingsContent />;
}
```

**File:** `src/components/settings-content.tsx` — extracted client component (move current settings page content here)

Existing settings page tests that test the client component UI (SWR fetch, dark mode, logout) move to test `SettingsContent` instead.

### Step 4: Verify

- [ ] New failing tests written for all 3 fixes
- [ ] `/app` page redirects to `/` when session is null
- [ ] `/api/auth/logout` returns 401 when session is null
- [ ] `/settings` page redirects to `/` when session is null (server-side)
- [ ] All existing tests pass (with adjustments for logout behavior change)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes with zero warnings

## Notes

- The middleware cookie-existence check remains as-is — it's a valid performance optimization. The security contract is: middleware rejects no-cookie requests, route-level `getSession()` validates everything else.
- The settings page SWR fetch to `/api/auth/session` remains in the extracted client component for session display data (email, Fitbit status). The server wrapper only handles the auth gate.
- FOO-128 (middleware cookie check) was previously marked Done as "acceptable pattern if routes validate" — this fix ensures all routes actually do validate.

---

## Iteration 1

**Implemented:** 2026-02-06

### Tasks Completed This Iteration
- Step 1: Fix `/app` page — added `redirect("/")` when `getSession()` returns null, removed optional chaining on `session.email`
- Step 2: Fix `/api/auth/logout` — made idempotent: valid session → destroy + 200, no session → clear stale cookie via `getRawSession().destroy()` + 200
- Step 3: Fix `/settings` page — converted to server component wrapper with `redirect("/")` on null session, extracted client UI to `src/components/settings-content.tsx`
- Step 4: Full verification passed

### Bug Hunter Findings (Fixed)
- **HIGH: Logout 401 regression** — Original plan used `validateSession()` to return 401 on no session, which would leave zombie iron-session cookies. Fixed by making logout idempotent: always clears cookie and returns 200, uses `getRawSession()` to destroy stale cookies when no DB session exists.

### Files Modified
- `src/app/app/page.tsx` — Added redirect import, null session guard, removed optional chaining
- `src/app/app/__tests__/page.test.tsx` — Added redirect mock and null session redirect test
- `src/app/api/auth/logout/route.ts` — Idempotent logout: destroy DB+cookie session or clear stale cookie
- `src/app/api/auth/logout/__tests__/route.test.ts` — Updated tests for idempotent behavior, stale cookie cleanup
- `src/app/settings/page.tsx` — Converted to server component with session redirect
- `src/app/settings/__tests__/page.test.tsx` — Added server component tests, updated client tests to use SettingsContent
- `src/components/settings-content.tsx` — New: extracted settings client UI

### Linear Updates
- FOO-155: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 HIGH bug (logout 401 regression), fixed before proceeding
- verifier: All 559 tests pass, zero warnings, typecheck/lint/build clean

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 7
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Conventions

No issues found - all implementations are correct and follow project conventions.

**Highlights:**
- Logout idempotent design (deviation from plan) correctly prevents zombie cookies — better than original 401 approach
- Server component wrappers for `/app` and `/settings` provide server-side auth gates before any UI renders
- `getRawSession().destroy()` correctly clears stale iron-session cookies when no DB session exists
- All tests properly simulate Next.js redirect behavior with throw pattern

### Linear Updates
- FOO-155: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
