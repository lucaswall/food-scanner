# Implementation Plan

**Created:** 2026-02-04
**Source:** Inline request: Iteration 1 of the roadmap — Foundation & Auth
**Linear Issues:** [FOO-1](https://linear.app/lw-claude/issue/FOO-1/set-up-test-framework-vitest), [FOO-2](https://linear.app/lw-claude/issue/FOO-2/define-shared-typescript-types-and-api-response-helpers), [FOO-3](https://linear.app/lw-claude/issue/FOO-3/implement-iron-session-configuration-and-getsession-helper), [FOO-4](https://linear.app/lw-claude/issue/FOO-4/add-auth-middleware-for-protected-routes), [FOO-5](https://linear.app/lw-claude/issue/FOO-5/implement-google-oauth-login-flow), [FOO-6](https://linear.app/lw-claude/issue/FOO-6/implement-fitbit-oauth-and-token-management), [FOO-7](https://linear.app/lw-claude/issue/FOO-7/add-session-validation-and-logout-routes), [FOO-8](https://linear.app/lw-claude/issue/FOO-8/build-landing-page-with-google-login-button), [FOO-9](https://linear.app/lw-claude/issue/FOO-9/build-settings-page-with-fitbit-reconnect-and-logout), [FOO-10](https://linear.app/lw-claude/issue/FOO-10/create-placeholder-app-page-protected), [FOO-11](https://linear.app/lw-claude/issue/FOO-11/update-documentation-for-iteration-1)

## Context Gathered

### Codebase Analysis
- **Existing source files:** 6 files — landing page (Coming Soon), global-error, layout, globals.css, favicon, /api/health route
- **Test setup:** None — no test framework, no test script in package.json
- **Dependencies:** Next.js 16.1.6, React 19.2.3, Tailwind CSS v4, TypeScript 5 (strict mode)
- **Path alias:** `@/*` maps to `./src/*`
- **API route pattern:** Simple async function named after HTTP method, returns `Response.json()`
- **Middleware:** Does not exist yet
- **next.config.ts:** Empty (default)
- **shadcn/ui:** Not yet installed — needs init before UI tasks

### MCP Context
- **Railway:** App deployed and running at https://food-scanner-production-0426.up.railway.app
- **Railway vars set:** SESSION_SECRET, ALLOWED_EMAIL, placeholder OAuth/API keys
- **Linear:** Food Scanner team created with FOO-xxx prefix

## Original Plan

### Task 1: Set up test framework (Vitest)
**Linear Issue:** [FOO-1](https://linear.app/lw-claude/issue/FOO-1/set-up-test-framework-vitest)

1. Install vitest, @vitejs/plugin-react, jsdom, @testing-library/react, @testing-library/jest-dom
2. Create `vitest.config.ts` with:
   - `@vitejs/plugin-react` plugin
   - `resolve.alias` for `@/` → `./src/`
   - `test.environment: 'jsdom'`
   - `test.globals: true`
   - `test.include: ['src/**/*.test.ts', 'src/**/*.test.tsx']`
3. Add `"test": "vitest run"` to package.json scripts
4. Write trivial test `src/lib/__tests__/setup.test.ts` that asserts `1 + 1 === 2`
5. Run verifier (expect pass)

### Task 2: Define shared TypeScript types and API response helpers
**Linear Issue:** [FOO-2](https://linear.app/lw-claude/issue/FOO-2/define-shared-typescript-types-and-api-response-helpers)

1. Write tests in `src/lib/__tests__/api-response.test.ts`:
   - `successResponse()` returns `{ success: true, data, timestamp }`
   - `errorResponse()` returns `{ success: false, error: { code, message }, timestamp }`
   - timestamp is a number
2. Run verifier (expect fail)
3. Create `src/types/index.ts` with all shared types:
   - `SessionData`, `FoodAnalysis`, `FoodLogRequest`, `FoodLogResponse`
   - `FitbitMealType` enum
   - `ApiSuccessResponse<T>`, `ApiErrorResponse`, `ApiResponse<T>`
   - `ErrorCode` string union (AUTH_INVALID_EMAIL, AUTH_SESSION_EXPIRED, AUTH_MISSING_SESSION, FITBIT_NOT_CONNECTED, FITBIT_TOKEN_INVALID, CLAUDE_API_ERROR, FITBIT_API_ERROR, VALIDATION_ERROR)
4. Create `src/lib/api-response.ts` with:
   - `successResponse<T>(data: T): Response` — returns `Response.json({ success: true, data, timestamp: Date.now() })`
   - `errorResponse(code: ErrorCode, message: string, status: number, details?: unknown): Response`
5. Refactor `src/app/api/health/route.ts` to use `successResponse()`
6. Run verifier (expect pass)

### Task 3: Implement iron-session configuration and getSession helper
**Linear Issue:** [FOO-3](https://linear.app/lw-claude/issue/FOO-3/implement-iron-session-configuration-and-getsession-helper)

1. Install `iron-session`
2. Write tests in `src/lib/__tests__/session.test.ts`:
   - `sessionOptions` has correct cookie name `'food-scanner-session'`
   - `sessionOptions.cookieOptions` has httpOnly, secure, sameSite strict, 30-day maxAge
   - `sessionOptions.password` reads from `process.env.SESSION_SECRET`
3. Run verifier (expect fail)
4. Create `src/lib/session.ts` with:
   - Import `SessionData` from `@/types`
   - `sessionOptions` with cookie config per ROADMAP.md
   - `getSession()` using `getIronSession<SessionData>()`
5. Run verifier (expect pass)

### Task 4: Add auth middleware for protected routes
**Linear Issue:** [FOO-4](https://linear.app/lw-claude/issue/FOO-4/add-auth-middleware-for-protected-routes)

1. Write tests in `src/__tests__/middleware.test.ts`:
   - Request to `/app` without cookie → redirects to `/`
   - Request to `/settings` without cookie → redirects to `/`
   - Request to `/api/log-food` without cookie → 401 JSON with AUTH_MISSING_SESSION
   - Request to `/api/health` → passes through (not matched)
   - Request to `/api/auth/google` → passes through (not matched)
   - Request with valid cookie → passes through
2. Run verifier (expect fail)
3. Create `middleware.ts` at project root with:
   - `config.matcher`: `['/app/:path*', '/settings/:path*', '/api/((?!health|auth).*)']`
   - Check for `food-scanner-session` cookie
   - API paths → 401 JSON, page paths → redirect to `/`
4. Run verifier (expect pass)

### Task 5: Implement Google OAuth login flow
**Linear Issue:** [FOO-5](https://linear.app/lw-claude/issue/FOO-5/implement-google-oauth-login-flow)

1. Write tests in `src/lib/__tests__/auth.test.ts`:
   - `buildGoogleAuthUrl()` returns URL with correct client_id, redirect_uri, scope, response_type
   - `buildGoogleAuthUrl()` includes `state` parameter for CSRF
2. Write tests in `src/app/api/auth/google/__tests__/route.test.ts`:
   - POST returns redirect to Google OAuth URL
3. Write tests in `src/app/api/auth/google/callback/__tests__/route.test.ts`:
   - Callback with valid code + allowed email → creates session, redirects
   - Callback with disallowed email → 403 with AUTH_INVALID_EMAIL
   - Callback with invalid code → error response
4. Run verifier (expect fail)
5. Create `src/lib/auth.ts` with:
   - `buildGoogleAuthUrl(state: string): string`
   - `exchangeGoogleCode(code: string): Promise<GoogleTokens>`
   - `getGoogleProfile(accessToken: string): Promise<{ email: string; name: string }>`
6. Create `src/app/api/auth/google/route.ts`:
   - POST: Generate state, store in cookie, redirect to Google
7. Create `src/app/api/auth/google/callback/route.ts`:
   - GET: Exchange code, validate email, create session, redirect to Fitbit OAuth or /app
8. Run verifier (expect pass)

### Task 6: Implement Fitbit OAuth and token management
**Linear Issue:** [FOO-6](https://linear.app/lw-claude/issue/FOO-6/implement-fitbit-oauth-and-token-management)

1. Write tests in `src/lib/__tests__/fitbit.test.ts`:
   - `buildFitbitAuthUrl()` returns URL with correct client_id, redirect_uri, scope (nutrition), response_type
   - `ensureFreshToken()` returns existing token if not expiring
   - `ensureFreshToken()` calls refresh if expiring within 1 hour
   - `ensureFreshToken()` throws FITBIT_TOKEN_INVALID if refresh fails
2. Write tests in `src/app/api/auth/fitbit/__tests__/route.test.ts`:
   - POST requires session, returns redirect to Fitbit OAuth URL
3. Write tests in `src/app/api/auth/fitbit/callback/__tests__/route.test.ts`:
   - Callback with valid code → stores tokens in session, redirects to /app
   - Callback with invalid code → error response
4. Run verifier (expect fail)
5. Create `src/lib/fitbit.ts` with:
   - `buildFitbitAuthUrl(state: string): string`
   - `exchangeFitbitCode(code: string): Promise<FitbitTokens>`
   - `refreshFitbitToken(refreshToken: string): Promise<FitbitTokens>`
   - `ensureFreshToken(session: SessionData): Promise<string>` — refresh if within 1 hour of expiry
6. Create `src/app/api/auth/fitbit/route.ts`:
   - POST: Validate session, generate state, redirect to Fitbit
7. Create `src/app/api/auth/fitbit/callback/route.ts`:
   - GET: Exchange code, store tokens in session, redirect to /app
8. Run verifier (expect pass)

### Task 7: Add session validation and logout routes
**Linear Issue:** [FOO-7](https://linear.app/lw-claude/issue/FOO-7/add-session-validation-and-logout-routes)

1. Write tests in `src/app/api/auth/session/__tests__/route.test.ts`:
   - GET with valid session → returns email, fitbit connected status, expiry
   - GET with expired session → 401 AUTH_SESSION_EXPIRED
   - GET without session → 401 AUTH_MISSING_SESSION
2. Write tests in `src/app/api/auth/logout/__tests__/route.test.ts`:
   - POST destroys session, returns success
3. Run verifier (expect fail)
4. Create `src/app/api/auth/session/route.ts`:
   - GET: Unseal session, check expiry, return status
5. Create `src/app/api/auth/logout/route.ts`:
   - POST: Destroy session, return success
6. Run verifier (expect pass)

### Task 8: Build landing page with Google login button
**Linear Issue:** [FOO-8](https://linear.app/lw-claude/issue/FOO-8/build-landing-page-with-google-login-button)

1. Initialize shadcn/ui: `npx shadcn@latest init`
2. Add needed shadcn components: Button
3. Write test in `src/app/__tests__/page.test.tsx`:
   - Renders app name "Food Scanner"
   - Renders "Login with Google" button
4. Run verifier (expect fail)
5. Rewrite `src/app/page.tsx`:
   - Hero section: app name, tagline
   - "Login with Google" button (form with POST to /api/auth/google)
   - Brief feature explanation (photo → AI → Fitbit)
   - Mobile-first layout
   - Server component: check session, redirect to /app if valid
6. Run verifier (expect pass)

### Task 9: Build settings page with Fitbit reconnect and logout
**Linear Issue:** [FOO-9](https://linear.app/lw-claude/issue/FOO-9/build-settings-page-with-fitbit-reconnect-and-logout)

1. Write test in `src/app/settings/__tests__/page.test.tsx`:
   - Renders "Settings" heading
   - Renders Fitbit connection status
   - Renders "Reconnect Fitbit" button
   - Renders "Logout" button
2. Run verifier (expect fail)
3. Create `src/app/settings/page.tsx`:
   - Server component fetching session data via /api/auth/session
   - Client component for interactive buttons
   - Fitbit status: connected/expired, token expiry date
   - "Reconnect Fitbit" → POST /api/auth/fitbit
   - "Logout" → POST /api/auth/logout, redirect to /
   - shadcn/ui Button components
4. Run verifier (expect pass)

### Task 10: Create placeholder /app page (protected)
**Linear Issue:** [FOO-10](https://linear.app/lw-claude/issue/FOO-10/create-placeholder-app-page-protected)

1. Write test in `src/app/app/__tests__/page.test.tsx`:
   - Renders "Food Scanner" heading
   - Renders link to /settings
2. Run verifier (expect fail)
3. Create `src/app/app/page.tsx`:
   - Server component: read session via getSession()
   - Display "Food Scanner" heading and user email
   - Link to /settings
   - Placeholder text: "Camera interface coming soon"
4. Run verifier (expect pass)

### Task 11: Update documentation for Iteration 1
**Linear Issue:** [FOO-11](https://linear.app/lw-claude/issue/FOO-11/update-documentation-for-iteration-1)

1. Update `CLAUDE.md`:
   - Add Vitest to tech stack table
   - Add `npm test` to commands section
   - Confirm structure section matches actual new files
2. Update `DEVELOPMENT.md`:
   - Add test command documentation
   - Document OAuth setup steps with real redirect URIs (local + Railway)
   - Add note about shadcn/ui being available
3. Update `README.md`:
   - Update API endpoints table to reflect implemented routes
   - Update environment variables section (remove "placeholder" language for OAuth keys)
4. Update `ROADMAP.md`:
   - Mark Iteration 1 as complete

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Build the foundation and authentication layer for the Food Scanner app

**Request:** Implement Iteration 1 of the roadmap — session management, Google OAuth, Fitbit OAuth, auth middleware, landing page, settings page, and placeholder app page

**Linear Issues:** FOO-1, FOO-2, FOO-3, FOO-4, FOO-5, FOO-6, FOO-7, FOO-8, FOO-9, FOO-10, FOO-11

**Approach:** Start with test framework setup and shared types as the foundation. Layer on iron-session and middleware for route protection. Then build Google and Fitbit OAuth flows with proper token management. Finally, add the UI pages (landing, settings, placeholder app) that tie it all together.

**Scope:**
- Tasks: 11
- Files affected: ~28 (new files: types, lib helpers, 8 route handlers, middleware, 3 pages + tests + doc updates)
- New tests: yes

**Key Decisions:**
- Vitest over Jest (better ESM support, faster, native TypeScript)
- shadcn/ui initialized in Task 8 (first UI task that needs it)
- Placeholder /app page instead of full camera UI (proves auth flow end-to-end, camera comes in Iteration 2)
- Google OAuth state parameter stored in a separate cookie for CSRF protection

**Risks/Considerations:**
- iron-session with Next.js 16 App Router — verify compatibility (iron-session v8+ supports it)
- Google OAuth redirect URI must match exactly what's configured in Google Cloud Console
- Fitbit OAuth requires `nutrition` scope specifically — verify available scopes at registration time
- shadcn/ui with Tailwind v4 — ensure compatible version is used
