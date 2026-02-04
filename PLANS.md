# Fix Plan: OAuth redirect URI uses internal container URL instead of public domain

**Issue:** [FOO-12](https://linear.app/lw-claude/issue/FOO-12/auth-oauth-redirect-uri-uses-internal-container-url-instead-of-public)
**Date:** 2026-02-04
**Status:** Planning
**Branch:** fix/oauth-redirect-uri

## Investigation

### Bug Report
Google OAuth login fails with `redirect_uri_mismatch` (Error 400) in production. User opens `https://food.lucaswall.me`, clicks "Login with Google", and Google rejects the request because the `redirect_uri` doesn't match any authorized URI.

The authorized URI in Google Cloud Console is: `https://food.lucaswall.me/api/auth/google/callback`

### Classification
- **Type:** Auth Issue
- **Severity:** Critical (login completely broken in production)
- **Affected Area:** All OAuth flows (Google and Fitbit)

### Root Cause Analysis
All four OAuth route handlers construct redirect URIs from `request.url`:

```typescript
const redirectUri = new URL("/api/auth/google/callback", request.url).toString();
```

Behind Railway's reverse proxy + Cloudflare CNAME, `request.url` resolves to the internal container address (`http://localhost:8080` or `http://10.244.164.165:8080`), not the public domain (`https://food.lucaswall.me`).

#### Evidence
- **File:** `src/app/api/auth/google/route.ts:5-8` — Builds Google redirect URI from `request.url`
- **File:** `src/app/api/auth/google/callback/route.ts:23` — Builds Google redirect URI from `request.url` for token exchange
- **File:** `src/app/api/auth/google/callback/route.ts:64` — Post-login redirect uses `request.url`
- **File:** `src/app/api/auth/fitbit/route.ts:5-8` — Builds Fitbit redirect URI from `request.url`
- **File:** `src/app/api/auth/fitbit/callback/route.ts:23-26` — Builds Fitbit redirect URI from `request.url` for token exchange
- **File:** `src/app/api/auth/fitbit/callback/route.ts:80` — Post-Fitbit redirect uses `request.url`
- **Logs:** Railway deployment shows `Local: http://localhost:8080`, confirming internal origin

### Impact
- Google OAuth login is completely broken in production
- Fitbit OAuth will also fail once Google login is fixed (same pattern)
- No workaround — the app is unusable in production

## Fix Plan (TDD Approach)

### Step 1: Write failing test for `getAppUrl()` helper
- **File:** `src/lib/__tests__/url.test.ts`
- **Tests:**
  - `getAppUrl()` returns `APP_URL` env var when set
  - `getAppUrl()` throws when `APP_URL` is not set
  - `buildUrl(path)` returns full URL using `APP_URL` as base

```typescript
describe("getAppUrl", () => {
  it("returns APP_URL when set", () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    expect(getAppUrl()).toBe("https://food.lucaswall.me");
  });

  it("throws when APP_URL is not set", () => {
    vi.stubEnv("APP_URL", "");
    expect(() => getAppUrl()).toThrow();
  });
});

describe("buildUrl", () => {
  it("builds full URL from path", () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    expect(buildUrl("/api/auth/google/callback")).toBe(
      "https://food.lucaswall.me/api/auth/google/callback"
    );
  });

  it("handles trailing slash in APP_URL", () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me/");
    expect(buildUrl("/api/auth/google/callback")).toBe(
      "https://food.lucaswall.me/api/auth/google/callback"
    );
  });
});
```

### Step 2: Implement `getAppUrl()` helper
- **File:** `src/lib/url.ts` (new file)

```typescript
export function getAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) {
    throw new Error("APP_URL environment variable is required");
  }
  return url.replace(/\/$/, "");
}

export function buildUrl(path: string): string {
  return `${getAppUrl()}${path}`;
}
```

### Step 3: Update Google OAuth route to use `buildUrl()`
- **File:** `src/app/api/auth/google/route.ts`
- **Change:** Replace `new URL("/api/auth/google/callback", request.url).toString()` with `buildUrl("/api/auth/google/callback")`
- **Test update:** `src/app/api/auth/google/__tests__/route.test.ts` — add `vi.stubEnv("APP_URL", "http://localhost:3000")`

### Step 4: Update Google OAuth callback to use `buildUrl()`
- **File:** `src/app/api/auth/google/callback/route.ts`
- **Changes:**
  - Line 23: Replace `new URL("/api/auth/google/callback", request.url).toString()` with `buildUrl("/api/auth/google/callback")`
  - Line 64: Replace `new URL(redirectTo, request.url).toString()` with `buildUrl(redirectTo)`
- **Test update:** `src/app/api/auth/google/callback/__tests__/route.test.ts` — add `vi.stubEnv("APP_URL", "http://localhost:3000")`

### Step 5: Update Fitbit OAuth route to use `buildUrl()`
- **File:** `src/app/api/auth/fitbit/route.ts`
- **Change:** Replace `new URL("/api/auth/fitbit/callback", request.url).toString()` with `buildUrl("/api/auth/fitbit/callback")`
- **Test update:** `src/app/api/auth/fitbit/__tests__/route.test.ts` — add `vi.stubEnv("APP_URL", "http://localhost:3000")`

### Step 6: Update Fitbit OAuth callback to use `buildUrl()`
- **File:** `src/app/api/auth/fitbit/callback/route.ts`
- **Changes:**
  - Lines 23-26: Replace `new URL("/api/auth/fitbit/callback", request.url).toString()` with `buildUrl("/api/auth/fitbit/callback")`
  - Line 80: Replace `new URL("/app", request.url).toString()` with `buildUrl("/app")`
- **Test update:** `src/app/api/auth/fitbit/callback/__tests__/route.test.ts` — add `vi.stubEnv("APP_URL", "http://localhost:3000")`

### Step 7: Update documentation
- **File:** `CLAUDE.md`
  - Add `APP_URL` to the environment variables section with description
- **File:** `DEVELOPMENT.md`
  - Add `APP_URL=http://localhost:3000` to the `.env.local` template
- **File:** `README.md`
  - Add `APP_URL=https://food.lucaswall.me` to the `railway variables set` command
  - Mention `APP_URL` in the environment variables context

### Step 8: Set `APP_URL` on Railway
- Run: `railway variables set APP_URL=https://food.lucaswall.me`
- This triggers a redeploy

### Verify
- [ ] New `url.test.ts` tests pass
- [ ] All existing tests still pass (with `APP_URL` stubbed)
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Google OAuth login works on `https://food.lucaswall.me`
- [ ] Fitbit OAuth flow works after Google login

## Notes
- `request.url` is still fine for reading query parameters (e.g., `code`, `state` in callbacks) — only URL *construction* needs `APP_URL`
- The `APP_URL` approach is deliberately simple. No header forwarding complexity with Cloudflare + Railway double-proxy.
- Local dev uses `APP_URL=http://localhost:3000` in `.env.local`

---

## Iteration 1

**Implemented:** 2026-02-04

### Tasks Completed This Iteration
- Step 1-2: Created `src/lib/url.ts` with `getAppUrl()` and `buildUrl()` helpers, plus full test coverage
- Step 3: Updated Google OAuth route (`src/app/api/auth/google/route.ts`) to use `buildUrl()`
- Step 4: Updated Google OAuth callback (`src/app/api/auth/google/callback/route.ts`) to use `buildUrl()` for both redirect URI and post-login redirect
- Step 5: Updated Fitbit OAuth route (`src/app/api/auth/fitbit/route.ts`) to use `buildUrl()`
- Step 6: Updated Fitbit OAuth callback (`src/app/api/auth/fitbit/callback/route.ts`) to use `buildUrl()` for both redirect URI and post-auth redirect
- Step 7: Updated documentation (CLAUDE.md, DEVELOPMENT.md, README.md) with `APP_URL` env var

### Files Modified
- `src/lib/url.ts` — New helper: `getAppUrl()`, `buildUrl()`
- `src/lib/__tests__/url.test.ts` — Tests for url helper (5 tests)
- `src/app/api/auth/google/route.ts` — Replaced `new URL(path, request.url)` with `buildUrl(path)`
- `src/app/api/auth/google/__tests__/route.test.ts` — Added APP_URL stub, APP_URL test, removed unused request args
- `src/app/api/auth/google/callback/route.ts` — Replaced 2 instances of URL construction from request.url
- `src/app/api/auth/google/callback/__tests__/route.test.ts` — Added APP_URL stub and APP_URL verification test
- `src/app/api/auth/fitbit/route.ts` — Replaced `new URL(path, request.url)` with `buildUrl(path)`
- `src/app/api/auth/fitbit/__tests__/route.test.ts` — Added APP_URL stub, APP_URL test, removed unused request args
- `src/app/api/auth/fitbit/callback/route.ts` — Replaced 2 instances of URL construction from request.url
- `src/app/api/auth/fitbit/callback/__tests__/route.test.ts` — Added APP_URL stub and APP_URL verification test
- `CLAUDE.md` — Added APP_URL to environment variables section
- `DEVELOPMENT.md` — Added APP_URL=http://localhost:3000 to .env.local template
- `README.md` — Added APP_URL=https://food.lucaswall.me to railway variables set command

### Linear Updates
- FOO-12: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed — no bugs found, all 6 request.url instances replaced, helper is correct
- verifier: All 57 tests pass, typecheck clean, build succeeds. 3 pre-existing lint issues in unmodified files (page.tsx, global-error.tsx, auth.test.ts)

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 13
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Test Quality, Conventions

No issues found - all implementations are correct and follow project conventions.

**Details:**
- All 6 `request.url`-based URL constructions correctly replaced with `buildUrl()`
- `request.url` correctly preserved for reading query parameters in callbacks
- `getAppUrl()` properly validates and normalizes `APP_URL` env var
- OAuth state validation (CSRF) and cookie flags preserved
- Tests cover APP_URL usage including internal-URL scenarios proving `request.url` is not used
- Documentation updated consistently across CLAUDE.md, DEVELOPMENT.md, README.md

### Linear Updates
- FOO-12: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
Ready for PR creation.

