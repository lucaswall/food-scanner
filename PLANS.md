# Fix Plan: Session cookie SameSite=strict breaks Fitbit OAuth flow

**Issue:** [FOO-21](https://linear.app/lw-claude/issue/FOO-21/auth-session-cookie-samesitestrict-breaks-fitbit-oauth-flow)
**Date:** 2026-02-04
**Status:** Planning
**Branch:** fix/FOO-21-session-samesite-oauth (proposed)

## Investigation

### Bug Report
After completing the full login flow (Google OAuth -> Fitbit OAuth -> /app), the session is silently corrupted. Railway deploy logs show `session_invalid` / `AUTH_MISSING_SESSION` warnings 7 seconds after a successful `fitbit_connect_success`. The `/app` page renders with `session.email` as `undefined`.

### Classification
- **Type:** Auth Issue
- **Severity:** Critical (login flow broken — session data lost after Fitbit OAuth)
- **Affected Area:** Session cookie configuration, Fitbit OAuth callback

### Root Cause Analysis

The session cookie is configured with `sameSite: "strict"` (`src/lib/session.ts:11`). When the browser follows Fitbit's OAuth redirect back to `/api/auth/fitbit/callback`, this is a **cross-site navigation** (from `api.fitbit.com` to `food.lucaswall.me`). Browsers do NOT send `SameSite=Strict` cookies on cross-site navigations.

As a result, the Fitbit callback's `getSession()` call reads an **empty cookie store** and creates a brand-new session. It then sets `session.fitbit = { ... }` on this empty session and calls `session.save()`, which **overwrites** the original session cookie (containing `sessionId`, `email`, `createdAt`, `expiresAt`) with one containing only Fitbit tokens.

#### Evidence

**Cookie configuration mismatch:**
- `google-oauth-state` cookie: `SameSite=Lax` (`src/app/api/auth/google/route.ts:16`) — works correctly
- `fitbit-oauth-state` cookie: `SameSite=Lax` (`src/app/api/auth/fitbit/route.ts:16`) — works correctly
- `food-scanner-session` cookie: `sameSite: "strict"` (`src/lib/session.ts:11`) — **broken on cross-site redirects**

**Browser SameSite behavior on OAuth callbacks (cross-site top-level GET):**
- `SameSite=Lax`: Sent on top-level navigations (GET redirects) -> OAuth state validation works
- `SameSite=Strict`: NOT sent on cross-site navigations -> Session lost

**Railway deploy logs (deployment `5fe626c3`, 2026-02-04):**
```
20:35:08 — google_login_success (session created with sessionId + email)
20:35:09 — fitbit_oauth_start (redirect to api.fitbit.com)
20:35:10 — fitbit_connect_success (session OVERWRITTEN with only fitbit data)
20:35:17 — session_invalid, reason: "missing" (sessionId is undefined)
```

**Next.js internals verified:** `Response.redirect()` DOES include cookies set via `cookies()` API — Next.js merges them in `app-route/module.js:419-426` via `appendMutableCookies()`. The bug is on the browser side (cookie not SENT), not the server side (cookie not SET).

#### Affected Code

The problematic configuration in `src/lib/session.ts:11`:
```typescript
sameSite: "strict",
```

The Fitbit callback that creates a new session when the cookie is missing (`src/app/api/auth/fitbit/callback/route.ts:44-52`):
```typescript
const session = await getSession(); // Returns empty session (cookie not sent)
session.fitbit = { ... };           // Sets fitbit on EMPTY session
await session.save();               // Overwrites original session
```

### Impact
- **Login flow completely broken** — After first-time login, the session loses `sessionId` and `email`
- **User sees undefined** — The `/app` page shows `undefined` instead of the user's email
- **Session validation fails** — `/api/auth/session` returns 401 because `sessionId` is missing
- **Fitbit reconnection from settings also affected** — Same cross-site redirect issue
- **ROADMAP.md specifies `strict`** (line 72) — the spec itself has the bug

## Fix Plan (TDD Approach)

### Step 1: Write Failing Test

- **File:** `src/lib/__tests__/session.test.ts`
- **Test:** Update existing test to expect `sameSite: "lax"` instead of `"strict"`

```typescript
it("has httpOnly, secure, sameSite lax, 30-day maxAge", () => {
  const opts = sessionOptions.cookieOptions!;
  expect(opts.httpOnly).toBe(true);
  expect(opts.secure).toBe(true);
  expect(opts.sameSite).toBe("lax");  // Changed from "strict"
  expect(opts.maxAge).toBe(30 * 24 * 60 * 60);
});
```

### Step 2: Implement Fix

- **File:** `src/lib/session.ts:11`
- **Change:** `sameSite: "strict"` -> `sameSite: "lax"`

```typescript
cookieOptions: {
  httpOnly: true,
  secure: true,
  sameSite: "lax",  // Must be "lax" for OAuth redirect flows
  maxAge: 30 * 24 * 60 * 60, // 30 days
  path: "/",
},
```

### Step 3: Update dependent test mocks

Update all test files that mock `sessionOptions` with `sameSite: "strict"` to use `"lax"`:
- `src/app/api/auth/fitbit/callback/__tests__/route.test.ts:28`
- `src/app/api/auth/google/callback/__tests__/route.test.ts:27`

### Step 4: Update documentation

- **File:** `ROADMAP.md:72` — Change `sameSite: 'strict'` to `sameSite: 'lax'`
- **File:** `CLAUDE.md` — Update the Security section cookie flags description

### Step 5: Verify

- [ ] Failing test now passes
- [ ] Existing tests still pass
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Manual verification: Full login flow (Google -> Fitbit -> /app) preserves session data

## Notes

- `SameSite=Lax` still provides CSRF protection: cookies are NOT sent on cross-site POST requests or subresource requests (fetch, images, iframes). Only top-level navigations (link clicks, GET redirects) include the cookie.
- This is the industry-standard recommendation for auth cookies in OAuth flows. All major OAuth libraries document this requirement.
- The OAuth state cookies (`google-oauth-state`, `fitbit-oauth-state`) already use `SameSite=Lax` correctly — only the session cookie was misconfigured.
- The Google OAuth callback is NOT affected by this bug because it creates a new session rather than reading an existing one. The bug is specific to the Fitbit callback, which needs to read and update the existing session.
