# Implementation Plan

**Created:** 2026-02-04
**Source:** Inline request: Add structured logging with proper log levels, optimized for Railway deployment, and instrument the existing codebase
**Linear Issues:** [FOO-13](https://linear.app/lw-claude/issue/FOO-13/install-pino-and-create-logger-module), [FOO-14](https://linear.app/lw-claude/issue/FOO-14/add-log_level-environment-variable-to-documentation), [FOO-15](https://linear.app/lw-claude/issue/FOO-15/instrument-api-response-helpers-with-automatic-logging), [FOO-16](https://linear.app/lw-claude/issue/FOO-16/instrument-middleware-with-auth-logging), [FOO-17](https://linear.app/lw-claude/issue/FOO-17/instrument-oauth-route-handlers-with-logging), [FOO-18](https://linear.app/lw-claude/issue/FOO-18/instrument-session-and-logout-routes-with-logging), [FOO-19](https://linear.app/lw-claude/issue/FOO-19/instrument-lib-helpers-authts-fitbitts-urlts-with-logging), [FOO-20](https://linear.app/lw-claude/issue/FOO-20/add-health-route-logging-and-startup-log-via-instrumentation)

## Context Gathered

### Codebase Analysis
- **Current state:** Zero `console.*` calls, zero logging libraries installed. Clean slate.
- **Route handlers (7):** `health`, `auth/google`, `auth/google/callback`, `auth/fitbit`, `auth/fitbit/callback`, `auth/session`, `auth/logout` — all use `errorResponse()`/`successResponse()` helpers
- **Middleware:** `middleware.ts` — auth enforcement, no logging
- **Error handling:** Try-catch in OAuth callbacks, errors thrown in `src/lib/auth.ts` and `src/lib/fitbit.ts` — no error details logged anywhere
- **API response helpers:** `src/lib/api-response.ts` — `successResponse()` and `errorResponse()` — natural integration point for automatic logging
- **Security rule (CLAUDE.md):** "Never log: Cookie values, access tokens, images, user descriptions"

### Railway Log Integration
- Railway captures stdout/stderr and auto-parses structured JSON
- Recognized fields: `message` (content), `level`/`severity` (debug/info/warn/error)
- Custom attributes queryable via `@attributeName:value` in Railway log explorer
- `log.msg` → `log.message`, `log.level` → `log.severity` (auto-normalized)
- Rate limit: 500 lines/sec/replica
- Recommendation: minified JSON, single-line, no pretty-printing in production

### Technology Choice: pino
- **Why pino over winston:** 5-10x faster (critical for serverless/edge), JSON output by default (perfect for Railway), smaller bundle, native NDJSON format
- **Why pino over console.log:** Structured JSON, log levels, automatic serialization, child loggers for request context, safe redaction of secrets
- **pino-pretty:** Dev-only transport for human-readable output
- **Compatibility:** Works with Next.js App Router server components and route handlers

### MCP Context
- **Railway:** Latest deployment `9300e615` is SUCCESS, app running Next.js 16.1.6. No existing errors in logs.
- **Linear:** No existing logging-related issues. Team: Food Scanner.

## Original Plan

### Task 1: Install pino and create logger module
**Linear Issue:** [FOO-13](https://linear.app/lw-claude/issue/FOO-13/install-pino-and-create-logger-module)

1. Write test in `src/lib/__tests__/logger.test.ts`:
   - Test: `createLogger()` returns a pino logger instance
   - Test: logger has correct default level based on NODE_ENV (debug in dev, info in production)
   - Test: logger outputs JSON with `message`, `level`, and `timestamp` fields
   - Test: child logger inherits parent context and adds request-scoped fields
   - Test: LOG_LEVEL env var overrides default level
2. Run verifier (expect fail)
3. Install dependencies: `npm install pino` and `npm install -D pino-pretty @types/pino`
4. Implement `src/lib/logger.ts`:
   - Create singleton pino logger with configuration:
     - `level`: `process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug')`
     - `timestamp: pino.stdTimeFunctions.isoTime` (ISO-8601 for Railway)
     - `messageKey: 'message'` (Railway normalizes `msg` → `message`, but emit `message` directly)
     - `formatters.level`: emit level as string name (Railway expects `debug`/`info`/`warn`/`error`)
     - Production: no transport (raw JSON to stdout — Railway parses natively)
     - Development: `pino-pretty` transport for readable console output
   - Export `logger` singleton and `createRequestLogger(method, path)` that returns a child logger with `method` and `path` fields
   - Export `LogLevel` type
5. Run verifier (expect pass)

### Task 2: Add LOG_LEVEL environment variable to documentation and configuration
**Linear Issue:** [FOO-14](https://linear.app/lw-claude/issue/FOO-14/add-log_level-environment-variable-to-documentation)

1. Update `CLAUDE.md`:
   - Add `LOG_LEVEL` to environment variables section (optional, defaults to `info` in production, `debug` in development)
   - Add `pino` to tech stack table
2. Update `DEVELOPMENT.md`:
   - Add `LOG_LEVEL` to local env setup (suggest `debug` for development)
3. Update `README.md`:
   - Add `LOG_LEVEL` to Railway environment variables section
4. Run verifier (expect pass — no code changes, only docs)

### Task 3: Instrument API response helpers with automatic logging
**Linear Issue:** [FOO-15](https://linear.app/lw-claude/issue/FOO-15/instrument-api-response-helpers-with-automatic-logging)

1. Write test in `src/lib/__tests__/api-response.test.ts`:
   - Test: `successResponse()` logs at info level with status code and response data summary
   - Test: `errorResponse()` logs at warn level with error code, message, and status
   - Test: `errorResponse()` with status >= 500 logs at error level
   - Test: sensitive fields (details containing tokens) are not included in log output
2. Run verifier (expect fail)
3. Implement changes to `src/lib/api-response.ts`:
   - Import logger from `@/lib/logger`
   - In `successResponse()`: log at info level with `{ status, dataType: typeof data }`
   - In `errorResponse()`: log at warn level (or error if status >= 500) with `{ status, errorCode: code, errorMessage: message }` — do NOT log `details` (may contain sensitive data)
4. Run verifier (expect pass)

### Task 4: Instrument middleware with auth logging
**Linear Issue:** [FOO-16](https://linear.app/lw-claude/issue/FOO-16/instrument-middleware-with-auth-logging)

1. Write test in `src/app/__tests__/middleware.test.ts` (or update existing if present):
   - Test: unauthenticated API request logs warn with path and "missing session"
   - Test: unauthenticated page request logs warn with path and "redirecting to landing"
   - Test: authenticated request logs debug with path
2. Run verifier (expect fail)
3. Implement changes to `middleware.ts`:
   - Import logger from `@/lib/logger`
   - Log `warn` on missing session for API routes: `{ path, action: 'denied', reason: 'missing_session' }`
   - Log `warn` on missing session for page routes: `{ path, action: 'redirect', reason: 'missing_session' }`
   - Log `debug` on successful auth pass-through: `{ path, action: 'allowed' }`
4. Run verifier (expect pass)

### Task 5: Instrument OAuth route handlers
**Linear Issue:** [FOO-17](https://linear.app/lw-claude/issue/FOO-17/instrument-oauth-route-handlers-with-logging)

1. Write test updates for OAuth route tests (update existing test files):
   - `src/app/api/auth/google/__tests__/route.test.ts`: verify log calls for OAuth initiation
   - `src/app/api/auth/google/callback/__tests__/route.test.ts`: verify log calls for success, invalid state, code exchange failure, profile fetch failure, unauthorized email
   - `src/app/api/auth/fitbit/__tests__/route.test.ts`: verify log calls for OAuth initiation
   - `src/app/api/auth/fitbit/callback/__tests__/route.test.ts`: verify log calls for success, invalid state, code exchange failure
2. Run verifier (expect fail)
3. Implement logging in OAuth routes:
   - `src/app/api/auth/google/route.ts`: log info on OAuth initiation `{ action: 'google_oauth_start' }`
   - `src/app/api/auth/google/callback/route.ts`:
     - log warn on invalid state `{ action: 'google_callback_invalid_state' }`
     - log error on code exchange failure `{ action: 'google_code_exchange_failed' }`
     - log error on profile fetch failure `{ action: 'google_profile_fetch_failed' }`
     - log warn on unauthorized email `{ action: 'google_unauthorized_email', email }` (email is allowed per security rules — it's the rejected email, not a secret)
     - log info on successful login `{ action: 'google_login_success', email }`
   - `src/app/api/auth/fitbit/route.ts`: log info on OAuth initiation `{ action: 'fitbit_oauth_start' }`
   - `src/app/api/auth/fitbit/callback/route.ts`:
     - log warn on invalid state `{ action: 'fitbit_callback_invalid_state' }`
     - log error on code exchange failure `{ action: 'fitbit_code_exchange_failed' }`
     - log info on successful Fitbit connection `{ action: 'fitbit_connect_success' }`
   - **Never log:** access tokens, refresh tokens, authorization codes, cookie values
4. Run verifier (expect pass)

### Task 6: Instrument session and logout routes
**Linear Issue:** [FOO-18](https://linear.app/lw-claude/issue/FOO-18/instrument-session-and-logout-routes-with-logging)

1. Write test updates:
   - `src/app/api/auth/session/__tests__/route.test.ts`: verify log calls for valid session, missing session, expired session
   - `src/app/api/auth/logout/__tests__/route.test.ts`: verify log call for logout
2. Run verifier (expect fail)
3. Implement logging:
   - `src/app/api/auth/session/route.ts`:
     - log debug on session check `{ action: 'session_check' }`
     - log warn on missing/expired session `{ action: 'session_invalid', reason }`
   - `src/app/api/auth/logout/route.ts`:
     - log info on logout `{ action: 'logout' }`
4. Run verifier (expect pass)

### Task 7: Instrument lib helpers (auth.ts, fitbit.ts, url.ts)
**Linear Issue:** [FOO-19](https://linear.app/lw-claude/issue/FOO-19/instrument-lib-helpers-authts-fitbitts-urlts-with-logging)

1. Write test updates:
   - `src/lib/__tests__/auth.test.ts`: verify log calls on token exchange failure, profile fetch failure
   - `src/lib/__tests__/fitbit.test.ts`: verify log calls on token exchange failure, token refresh failure
   - `src/lib/__tests__/url.test.ts`: verify log call on missing APP_URL
2. Run verifier (expect fail)
3. Implement logging:
   - `src/lib/auth.ts`:
     - log error on Google token exchange HTTP failure: `{ action: 'google_token_exchange_failed', status: response.status }`
     - log error on Google profile fetch HTTP failure: `{ action: 'google_profile_fetch_failed', status: response.status }`
   - `src/lib/fitbit.ts`:
     - log error on Fitbit token exchange HTTP failure: `{ action: 'fitbit_token_exchange_failed', status: response.status }`
     - log error on Fitbit token refresh HTTP failure: `{ action: 'fitbit_token_refresh_failed', status: response.status }`
     - log debug on token refresh triggered: `{ action: 'fitbit_token_refresh_start' }`
   - `src/lib/url.ts`:
     - log error on missing APP_URL: `{ action: 'missing_app_url' }`
   - **Never log:** response bodies, tokens, secrets, credentials
4. Run verifier (expect pass)

### Task 8: Add health route logging and startup log
**Linear Issue:** [FOO-20](https://linear.app/lw-claude/issue/FOO-20/add-health-route-logging-and-startup-log-via-instrumentation)

1. Write test update:
   - `src/app/api/health/__tests__/route.test.ts`: verify health check logs at debug level
2. Run verifier (expect fail)
3. Implement:
   - `src/app/api/health/route.ts`: log debug `{ action: 'health_check' }`
   - Add Next.js instrumentation file `src/instrumentation.ts` (Next.js 16 convention):
     - Log info on server startup: `{ action: 'server_start', nodeEnv: process.env.NODE_ENV, logLevel }`
     - This runs once when the server starts, providing a clear "app started" log line in Railway
4. Run verifier (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Add structured logging with pino, optimized for Railway's JSON log parsing, and instrument all existing server-side code

**Request:** Add a proper logging technology with logging level and proper output that maximizes the Railway environment and implement logs in the current codebase appropriately

**Linear Issues:** [FOO-13](https://linear.app/lw-claude/issue/FOO-13/install-pino-and-create-logger-module), [FOO-14](https://linear.app/lw-claude/issue/FOO-14/add-log_level-environment-variable-to-documentation), [FOO-15](https://linear.app/lw-claude/issue/FOO-15/instrument-api-response-helpers-with-automatic-logging), [FOO-16](https://linear.app/lw-claude/issue/FOO-16/instrument-middleware-with-auth-logging), [FOO-17](https://linear.app/lw-claude/issue/FOO-17/instrument-oauth-route-handlers-with-logging), [FOO-18](https://linear.app/lw-claude/issue/FOO-18/instrument-session-and-logout-routes-with-logging), [FOO-19](https://linear.app/lw-claude/issue/FOO-19/instrument-lib-helpers-authts-fitbitts-urlts-with-logging), [FOO-20](https://linear.app/lw-claude/issue/FOO-20/add-health-route-logging-and-startup-log-via-instrumentation)

**Approach:** Install pino as the logging library with Railway-optimized JSON output (messageKey: 'message', string level names, ISO timestamps). Create a centralized logger module with environment-aware configuration (LOG_LEVEL env var, pino-pretty in dev). Instrument all existing code systematically: API response helpers (automatic logging for all responses), middleware (auth decisions), OAuth flows (login/callback lifecycle), session management, and library helpers (external API call failures). Follow strict security rules — never log tokens, secrets, cookies, or images.

**Scope:**
- Tasks: 8
- Files affected: ~16 (1 new logger module, 1 new instrumentation file, 14 existing files modified)
- New tests: yes (new logger tests + updates to ~10 existing test files)

**Key Decisions:**
- pino over winston: Better performance, native JSON/NDJSON, smaller bundle, ideal for serverless
- `messageKey: 'message'` to emit Railway's expected field name directly (avoids relying on Railway's `msg` → `message` normalization)
- `formatters.level` emits string names (`info`, `warn`, `error`) instead of pino's default numeric levels — Railway normalizes these for color-coding
- pino-pretty as dev-only transport (not bundled in production)
- LOG_LEVEL env var for runtime control without redeployment
- Instrumentation file (`src/instrumentation.ts`) for startup logging — Next.js 16 standard pattern
- Logging integrated into `errorResponse()`/`successResponse()` for automatic coverage of all API responses

**Risks/Considerations:**
- Middleware runs in Edge Runtime by default — pino works in Node.js runtime. May need to verify middleware runs in Node.js runtime or use a lightweight alternative for middleware logging. If Edge runtime is required, middleware logging may need to use `console.*` with structured JSON instead.
- Test mocking: pino logger needs to be mockable in tests. Use `vi.mock('@/lib/logger')` pattern.
- Log volume: OAuth callbacks and session checks are infrequent (single-user app), so no risk of hitting Railway's 500 lines/sec limit.

---

## Iteration 1

**Implemented:** 2026-02-04

### Tasks Completed This Iteration
- Task 1: Install pino and create logger module - Created `src/lib/logger.ts` with Railway-optimized config, 7 tests
- Task 2: Add LOG_LEVEL to documentation - Updated CLAUDE.md, DEVELOPMENT.md, README.md
- Task 3: Instrument API response helpers - Added auto-logging to successResponse/errorResponse, 5 new tests
- Task 4: Instrument middleware with auth logging - Added warn/debug logging for auth decisions, forced Node.js runtime, 3 new tests
- Task 5: Instrument OAuth route handlers - Added logging to all 4 OAuth routes (Google/Fitbit init + callbacks), 4 new tests
- Task 6: Instrument session and logout routes - Added logging to session check and logout, 4 new tests
- Task 7: Instrument lib helpers - Added logging to auth.ts, fitbit.ts, url.ts for HTTP failures, 6 new tests
- Task 8: Health route logging and startup log - Added health check debug logging, created instrumentation.ts for startup log, 2 new tests

### Files Modified
- `src/lib/logger.ts` - Created: pino singleton, Railway-optimized config, test helpers
- `src/lib/api-response.ts` - Added auto-logging to success/error responses
- `src/lib/auth.ts` - Added error logging on Google token exchange and profile fetch failures
- `src/lib/fitbit.ts` - Added error/debug logging on Fitbit token exchange, refresh failures
- `src/lib/url.ts` - Added error logging on missing APP_URL
- `middleware.ts` - Added auth decision logging, forced Node.js runtime for pino compatibility
- `src/app/api/auth/google/route.ts` - Added OAuth initiation logging
- `src/app/api/auth/google/callback/route.ts` - Added invalid state, unauthorized email, success logging
- `src/app/api/auth/fitbit/route.ts` - Added OAuth initiation logging
- `src/app/api/auth/fitbit/callback/route.ts` - Added invalid state, success logging
- `src/app/api/auth/session/route.ts` - Added session check/invalid logging
- `src/app/api/auth/logout/route.ts` - Added logout logging
- `src/app/api/health/route.ts` - Added health check debug logging
- `src/instrumentation.ts` - Created: startup log with nodeEnv and logLevel
- `CLAUDE.md` - Added pino to tech stack, LOG_LEVEL to env vars, logger.ts to structure
- `DEVELOPMENT.md` - Added LOG_LEVEL to local env setup
- `README.md` - Added LOG_LEVEL to Railway env vars
- `package.json` - Added pino, pino-pretty dependencies; removed deprecated @types/pino
- Test files (13 files updated/created with logger mock setup and logging assertions)

### Linear Updates
- FOO-13: Todo → In Progress → Review
- FOO-14: Todo → In Progress → Review
- FOO-15: Todo → In Progress → Review
- FOO-16: Todo → In Progress → Review
- FOO-17: Todo → In Progress → Review
- FOO-18: Todo → In Progress → Review
- FOO-19: Todo → In Progress → Review
- FOO-20: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 6 bugs (1 HIGH, 4 MEDIUM, 1 LOW), all fixed before proceeding:
  - HIGH: Middleware Edge Runtime incompatibility — fixed by adding `export const runtime = "nodejs"`
  - MEDIUM: Duplicate logging in route catch blocks + lib helpers + errorResponse — removed route-level catch logging
  - MEDIUM: Unsafe LOG_LEVEL type cast — added runtime validation with Set
  - MEDIUM: Double getTransport() call — stored result in variable
  - LOW: Deprecated @types/pino — removed package
- verifier: All 96 tests pass, zero warnings

### Review Findings

Files reviewed: 18 source files, 13 test files
Checks applied: Security (OWASP), Logic, Async, Resources, Type Safety, Error Handling, Conventions (CLAUDE.md)

No issues found - all implementations are correct and follow project conventions.

**Details:**
- Security: No secrets logged anywhere; `details` parameter excluded from error logs; auth enforcement correct; cookie flags properly set
- Logic: Log level validation with `Set` is correct; session expiry comparison correct; all error paths log before throwing/returning
- Async: All promises properly awaited; no fire-and-forget operations
- Resources: Logger is singleton; transport result stored in variable (no double creation)
- Type Safety: No unsafe casts; `LogLevel` type properly constrained; runtime validation for LOG_LEVEL env var
- Conventions: All imports use `@/` alias; file naming correct; documentation updated in all three files (CLAUDE.md, DEVELOPMENT.md, README.md)
- Tests: Logger tests use real pino instances with custom destinations (strong validation); all route tests assert correct log actions/levels; security test verifies `details` excluded from logs
- Edge Runtime: `export const runtime = "nodejs"` correctly addresses pino/Edge incompatibility in middleware

### Linear Updates
- FOO-13: Review → Merge
- FOO-14: Review → Merge
- FOO-15: Review → Merge
- FOO-16: Review → Merge
- FOO-17: Review → Merge
- FOO-18: Review → Merge
- FOO-19: Review → Merge
- FOO-20: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
Ready for PR creation.
