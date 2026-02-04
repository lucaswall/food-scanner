# Fix Plan: OAuth iron-session crash and lint errors

**Date:** 2026-02-04
**Status:** IN_PROGRESS

## Summary

Two bugs need fixing:
1. **OAuth callback 500 error** — `getIronSession` called with invalid argument in both Google and Fitbit callback routes, causing `TypeError: e.get is not a function` at runtime
2. **Lint errors** — 1 error and 2 warnings preventing `npm run lint` from passing

## Issues

### Bug 1: OAuth iron-session crash

**Priority:** Critical
**Labels:** Bug
**Classification:** Auth Issue
**Affected Area:** `/api/auth/google/callback`, `/api/auth/fitbit/callback`

#### Bug Report
Google OAuth callback returns HTTP 500. Railway deploy logs show:
```
TypeError: e.get is not a function
```

#### Root Cause Analysis
Both OAuth callback routes call `getIronSession` with `{ headers: responseHeaders } as never` — a plain object that lacks the `.get()` and `.set()` methods iron-session v8 requires.

The correct approach (already used in `src/lib/session.ts:17-19`) is to pass the cookie store from `cookies()` (`next/headers`), which provides the required interface. When `cookies()` is used in a route handler, iron-session writes Set-Cookie headers automatically through Next.js's cookie API.

#### Evidence
- **File:** `src/app/api/auth/google/callback/route.ts:46-48` — `getIronSession({ headers: responseHeaders } as never, sessionOptions)` crashes because the object has no `.get()` method
- **File:** `src/app/api/auth/fitbit/callback/route.ts:44-47` — Same pattern: `getIronSession({ headers: request.headers } as never, sessionOptions)` — also crashes
- **File:** `src/app/api/auth/fitbit/callback/route.ts:57-59` — Second `getIronSession` call with same invalid pattern
- **File:** `src/lib/session.ts:17-19` — Shows the correct pattern: `getIronSession<SessionData>(cookieStore, sessionOptions)` using `await cookies()`
- **Logs:** Railway deploy logs confirm `TypeError: e.get is not a function`

#### Impact
- Login is completely broken in production — users cannot authenticate
- Both Google and Fitbit OAuth flows crash on callback

### Bug 2: Lint errors

**Priority:** Medium
**Labels:** Bug
**Classification:** Code quality
**Affected Area:** `src/app/page.tsx`, `src/app/global-error.tsx`, `src/lib/__tests__/auth.test.ts`

#### Bug Report
`npm run lint` exits with code 1 — 1 error and 2 warnings:
1. **ERROR** `src/app/page.tsx:8` — `react-hooks/purity`: `Date.now()` is an impure function called during render
2. **WARNING** `src/app/global-error.tsx:4` — `@typescript-eslint/no-unused-vars`: `error` parameter is defined but never used
3. **WARNING** `src/lib/__tests__/auth.test.ts:1` — `@typescript-eslint/no-unused-vars`: `beforeEach` is imported but never used

#### Root Cause Analysis
1. `Date.now()` in a Server Component render function violates React's purity rule. The session expiry check should use a helper that doesn't call `Date.now()` inline during render — or the check can be restructured.
2. `global-error.tsx` receives `error` prop per Next.js convention but doesn't use it.
3. `auth.test.ts` imports `beforeEach` from vitest but never calls it.

#### Impact
- `npm run lint` fails, blocking CI/verifier checks
- The `Date.now()` purity violation is also a correctness concern — React may call the render function multiple times

## Implementation Tasks

### Task 1: Fix Google OAuth callback iron-session usage
**Linear Issue:** Create manually — Linear MCP not connected

**TDD Steps:**

1. Write test in `src/app/api/auth/google/callback/__tests__/route.test.ts`:
   - Update the mock for `iron-session` to also mock `getIronSession` via the `cookies()` pattern
   - Mock `next/headers` `cookies()` to return a mock cookie store
   - Add test: callback with valid code uses `cookies()` store (not raw headers) and sets session + redirects
   - Ensure existing tests still pass with the updated mock setup

2. Implement fix in `src/app/api/auth/google/callback/route.ts`:
   - Import `cookies` from `next/headers`
   - Replace `getIronSession({ headers: responseHeaders } as never, sessionOptions)` with `getIronSession<SessionData>(await cookies(), sessionOptions)` — same pattern as `getSession()` in `src/lib/session.ts`
   - Remove the manual `responseHeaders` for session management — `cookies()` handles Set-Cookie automatically
   - Keep the state cookie clearing via `cookies().delete('google-oauth-state')` or a manual Set-Cookie on the redirect response
   - Use `NextResponse.redirect()` from `next/server` for the redirect (preserves cookies set through the cookie store)
   - Remove unused `responseHeaders`, `getIronSession` import if now using `getSession` from `@/lib/session`

3. Run verifier (expect pass)

### Task 2: Fix Fitbit OAuth callback iron-session usage
**Linear Issue:** Create manually — Linear MCP not connected

**TDD Steps:**

1. Write test in `src/app/api/auth/fitbit/callback/__tests__/route.test.ts`:
   - Same approach as Task 1: mock `next/headers` `cookies()`
   - Add test: callback reads existing session via `cookies()` store, adds Fitbit tokens, saves, and redirects
   - Verify the double-`getIronSession` pattern is eliminated (was a workaround for the broken approach)

2. Implement fix in `src/app/api/auth/fitbit/callback/route.ts`:
   - Import `cookies` from `next/headers`
   - Replace the two `getIronSession` calls with a single `getIronSession<SessionData>(await cookies(), sessionOptions)` — this reads the existing session AND writes back via the same cookie store
   - Remove the `Object.assign(responseSession, ...)` workaround — a single session object handles read+write
   - Use `NextResponse.redirect()` for the redirect
   - Clear the Fitbit state cookie via `cookies().delete('fitbit-oauth-state')` or manual Set-Cookie

3. Run verifier (expect pass)

### Task 3: Fix lint errors
**Linear Issue:** Create manually — Linear MCP not connected

**TDD Steps:**

1. Fix `src/app/page.tsx:8` — `Date.now()` purity error:
   - Move the session expiry check out of the render path, or restructure to avoid calling `Date.now()` inline
   - Option: check `session.sessionId` only (the session cookie itself expires via `maxAge`), making the `expiresAt` check redundant for the redirect decision
   - Or: extract the timestamp before render logic

2. Fix `src/app/global-error.tsx:4` — unused `error` parameter:
   - Prefix with underscore: `_error` to indicate intentionally unused
   - Or use the `error` prop (e.g., display `error.message`)

3. Fix `src/lib/__tests__/auth.test.ts:1` — unused `beforeEach` import:
   - Remove `beforeEach` from the import statement

4. Run `npm run lint` — expect clean (0 errors, 0 warnings)
5. Run verifier full mode — expect all tests pass, lint clean, build passes

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass, lint clean, zero warnings
