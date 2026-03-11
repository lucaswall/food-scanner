# Implementation Plan

**Created:** 2026-03-11
**Source:** Inline request: Add 5 new external API v1 endpoints (food-history, common-foods, search-foods, fasting, earliest-entry) with Bearer token auth
**Linear Issues:** [FOO-863](https://linear.app/lw-claude/issue/FOO-863/add-get-apiv1food-history-endpoint), [FOO-864](https://linear.app/lw-claude/issue/FOO-864/add-get-apiv1common-foods-endpoint), [FOO-865](https://linear.app/lw-claude/issue/FOO-865/add-get-apiv1search-foods-endpoint), [FOO-866](https://linear.app/lw-claude/issue/FOO-866/add-get-apiv1fasting-endpoint), [FOO-867](https://linear.app/lw-claude/issue/FOO-867/add-get-apiv1earliest-entry-endpoint)
**Branch:** feat/FOO-863-v1-food-query-endpoints

## Context Gathered

### Codebase Analysis
- **Related files:**
  - Existing v1 routes: `src/app/api/v1/food-log/route.ts` (template pattern), `src/app/api/v1/nutrition-summary/route.ts`, `src/app/api/v1/activity-summary/route.ts`, `src/app/api/v1/nutrition-goals/route.ts`, `src/app/api/v1/lumen-goals/route.ts`
  - Browser routes to mirror: `src/app/api/food-history/route.ts`, `src/app/api/common-foods/route.ts`, `src/app/api/search-foods/route.ts`, `src/app/api/fasting/route.ts`, `src/app/api/earliest-entry/route.ts`
  - Auth: `src/lib/api-auth.ts` (`validateApiRequest`, `hashForRateLimit`)
  - Response: `src/lib/api-response.ts` (`conditionalResponse`, `errorResponse`)
  - Business logic: `src/lib/food-log.ts` (`getFoodLogHistory`, `getCommonFoods`, `getRecentFoods`, `searchFoods`, `getEarliestEntryDate`), `src/lib/fasting.ts` (`getFastingWindow`, `getFastingWindows`)
  - Date utils: `src/lib/date-utils.ts` (`isValidDateFormat`)
  - Rate limiting: `src/lib/rate-limit.ts` (`checkRateLimit`)
  - Types: `src/types/index.ts` (`ErrorCode`)
- **Existing patterns:** All v1 routes follow identical structure: `validateApiRequest()` → extract API key for rate limiting → `checkRateLimit()` with hashed key → validate query params → call business logic with `authResult.userId` → `conditionalResponse()`. DB-only routes use 60 req/min; Fitbit routes use 30 req/min. All five new routes are DB-only.
- **Test conventions:** Colocated `__tests__/route.test.ts` under each v1 route directory. Mock `@/lib/api-auth`, `@/lib/logger`, `@/lib/food-log`, `@/lib/rate-limit`. Use `createRequest()` helper. Test coverage: success, auth failure (401), validation errors (400), rate limit (429), Cache-Control header, ETag, 304 Not Modified, rate limit key format.

### MCP Context
- **MCPs used:** Linear (issue creation)
- **Findings:** No existing issues for v1 food query endpoints. Created FOO-863, FOO-864, FOO-865, FOO-866, FOO-867.

## Tasks

### Task 1: Add GET /api/v1/food-history endpoint
**Linear Issue:** [FOO-863](https://linear.app/lw-claude/issue/FOO-863/add-get-apiv1food-history-endpoint)
**Files:**
- `src/app/api/v1/food-history/__tests__/route.test.ts` (create)
- `src/app/api/v1/food-history/route.ts` (create)

**Steps:**
1. Write tests in `src/app/api/v1/food-history/__tests__/route.test.ts` following the exact mock/structure pattern from `src/app/api/v1/food-log/__tests__/route.test.ts`:
   - Mock `@/lib/api-auth` (validateApiRequest + hashForRateLimit), `@/lib/logger`, `@/lib/food-log` (getFoodLogHistory), `@/lib/rate-limit`
   - Success: valid auth + valid params returns paginated entries from `getFoodLogHistory`
   - Success with cursor params: `lastDate`, `lastTime`, `lastId` parsed and passed as cursor object
   - Success with `endDate` filter param
   - Success with `limit` param (clamped 1-50, default 20)
   - Auth failure: returns 401 when `validateApiRequest` returns Response
   - Rate limit exceeded: returns 429
   - Rate limit key format: `v1:food-history:hashed-<key>` with 60 req/min
   - Cache-Control: `private, no-cache`
   - ETag header present on success
   - 304 Not Modified when If-None-Match matches ETag
   - Internal error: returns 500 when `getFoodLogHistory` throws
2. Run verifier with pattern `"v1/food-history"` (expect fail)
3. Implement `src/app/api/v1/food-history/route.ts`:
   - Follow `src/app/api/v1/food-log/route.ts` as template for auth + rate limit boilerplate
   - Port query param parsing logic from `src/app/api/food-history/route.ts` (endDate, cursor with lastDate/lastTime/lastId, limit with 1-50 clamp and default 20)
   - Call `getFoodLogHistory(authResult.userId, { endDate, cursor, limit }, log)` instead of session-based userId
   - Return `conditionalResponse(request, { entries })`
   - Error handling: catch block returns `errorResponse("INTERNAL_ERROR", "Failed to get food log history", 500)`
4. Run verifier with pattern `"v1/food-history"` (expect pass)

**Notes:**
- No date validation needed — `endDate` is optional and silently ignored if malformed (same as browser route). Cursor params are also optional.
- The browser route at `src/app/api/food-history/route.ts` uses inline DATE_REGEX/TIME_REGEX — reuse the same regex patterns for cursor param validation.

### Task 2: Add GET /api/v1/common-foods endpoint
**Linear Issue:** [FOO-864](https://linear.app/lw-claude/issue/FOO-864/add-get-apiv1common-foods-endpoint)
**Files:**
- `src/app/api/v1/common-foods/__tests__/route.test.ts` (create)
- `src/app/api/v1/common-foods/route.ts` (create)

**Steps:**
1. Write tests in `src/app/api/v1/common-foods/__tests__/route.test.ts`:
   - Mock `@/lib/api-auth`, `@/lib/logger`, `@/lib/food-log` (getCommonFoods, getRecentFoods), `@/lib/rate-limit`, `@/lib/date-utils` (isValidDateFormat)
   - **Default tab (foods):**
     - Success: returns foods + nextCursor from `getCommonFoods`
     - With `clientDate` and `clientTime` params: passed to `getCommonFoods`
     - With score-based cursor: `{"score":0.95,"id":5}` parsed and passed
     - Invalid `clientDate` format: returns 400 VALIDATION_ERROR
     - Invalid `clientTime` format: returns 400 VALIDATION_ERROR
     - Invalid cursor JSON: returns 400 VALIDATION_ERROR
     - Invalid cursor shape (missing score/id): returns 400 VALIDATION_ERROR
   - **Recent tab (`tab=recent`):**
     - Success: returns foods + nextCursor from `getRecentFoods`
     - With time-based cursor: `{"lastDate":"...","lastTime":null,"lastId":5}` parsed and passed
     - Invalid cursor format: returns 400 VALIDATION_ERROR
   - **Shared tests:**
     - `limit` param clamped 1-50, default 10
     - Auth failure: 401
     - Rate limit exceeded: 429
     - Rate limit key: `v1:common-foods:hashed-<key>` with 60 req/min
     - Cache-Control: `private, no-cache`
     - ETag + 304 Not Modified
     - Internal error: 500
2. Run verifier with pattern `"v1/common-foods"` (expect fail)
3. Implement `src/app/api/v1/common-foods/route.ts`:
   - Follow v1 auth + rate limit boilerplate from `src/app/api/v1/food-log/route.ts`
   - Port all query param parsing and cursor validation logic from `src/app/api/common-foods/route.ts` — both tabs (recent with time-based cursor, default with score-based cursor), clientDate/clientTime validation using `isValidDateFormat`, limit clamping
   - Replace `session!.userId` with `authResult.userId`
   - Return `conditionalResponse(request, { foods, nextCursor })`
   - Error handling: catch block returns `errorResponse("INTERNAL_ERROR", "Failed to get common foods", 500)`
4. Run verifier with pattern `"v1/common-foods"` (expect pass)

**Notes:**
- This is the most complex of the three routes due to two tab modes with different cursor shapes. Follow the browser route logic exactly — do not simplify or change validation behavior.

### Task 3: Add GET /api/v1/search-foods endpoint
**Linear Issue:** [FOO-865](https://linear.app/lw-claude/issue/FOO-865/add-get-apiv1search-foods-endpoint)
**Files:**
- `src/app/api/v1/search-foods/__tests__/route.test.ts` (create)
- `src/app/api/v1/search-foods/route.ts` (create)

**Steps:**
1. Write tests in `src/app/api/v1/search-foods/__tests__/route.test.ts`:
   - Mock `@/lib/api-auth`, `@/lib/logger`, `@/lib/food-log` (searchFoods), `@/lib/rate-limit`
   - Success: valid `q` param returns foods from `searchFoods`
   - Query splitting: `q` is lowercased and split by whitespace into keywords array passed to `searchFoods`
   - Missing `q` param: returns 400 VALIDATION_ERROR "Query must be at least 2 characters"
   - `q` too short (1 char): returns 400 VALIDATION_ERROR
   - `q` with only whitespace (splits to empty): returns 400 VALIDATION_ERROR "Query must contain at least one word"
   - `limit` param clamped 1-50, default 10
   - Auth failure: 401
   - Rate limit exceeded: 429
   - Rate limit key: `v1:search-foods:hashed-<key>` with 60 req/min
   - Cache-Control: `private, no-cache`
   - ETag + 304 Not Modified
   - Internal error: 500
2. Run verifier with pattern `"v1/search-foods"` (expect fail)
3. Implement `src/app/api/v1/search-foods/route.ts`:
   - Follow v1 auth + rate limit boilerplate
   - Port query validation logic from `src/app/api/search-foods/route.ts`: `q` param required with min 2 chars, split by whitespace into keywords, reject if empty after split
   - Call `searchFoods(authResult.userId, keywords, { limit }, log)`
   - Return `conditionalResponse(request, { foods })`
   - Error handling: catch block returns `errorResponse("INTERNAL_ERROR", "Failed to search foods", 500)`
4. Run verifier with pattern `"v1/search-foods"` (expect pass)

**Notes:**
- Simplest of the three routes — no cursor, no tabs, just query + limit.

### Task 4: Add GET /api/v1/fasting endpoint
**Linear Issue:** [FOO-866](https://linear.app/lw-claude/issue/FOO-866/add-get-apiv1fasting-endpoint)
**Files:**
- `src/app/api/v1/fasting/__tests__/route.test.ts` (create)
- `src/app/api/v1/fasting/route.ts` (create)

**Steps:**
1. Write tests in `src/app/api/v1/fasting/__tests__/route.test.ts`:
   - Mock `@/lib/api-auth`, `@/lib/logger`, `@/lib/fasting` (getFastingWindow, getFastingWindows), `@/lib/rate-limit`, `@/lib/date-utils` (isToday, addDays, isValidDateFormat)
   - **Single date mode (no `from`/`to`):**
     - Success: valid `date` param returns `{ window, live }` from `getFastingWindow`
     - Live detection: when `clientDate` matches `date` and `firstMealTime` is null, `live` object is populated with `lastMealTime` and `startDate` (date - 1 day via `addDays`)
     - Live detection off: when `firstMealTime` is not null, `live` is null
     - No clientDate: falls back to `isToday()` check for live detection
     - Missing `date` param: returns 400 VALIDATION_ERROR "Missing date parameter"
     - Invalid `date` format: returns 400 VALIDATION_ERROR "Invalid date format. Use YYYY-MM-DD"
   - **Date range mode (`from` + `to`):**
     - Success: valid `from` and `to` return `{ windows }` from `getFastingWindows`
     - Missing `from` (only `to` provided): returns 400 VALIDATION_ERROR
     - Missing `to` (only `from` provided): returns 400 VALIDATION_ERROR
     - Invalid `from` format: returns 400 VALIDATION_ERROR
     - Invalid `to` format: returns 400 VALIDATION_ERROR
     - `from` after `to`: returns 400 VALIDATION_ERROR "from date must be before or equal to to date"
   - **Shared tests:**
     - Auth failure: 401
     - Rate limit exceeded: 429
     - Rate limit key: `v1:fasting:hashed-<key>` with 60 req/min
     - Cache-Control: `private, no-cache`
     - ETag + 304 Not Modified
     - Internal error: 500
2. Run verifier with pattern `"v1/fasting"` (expect fail)
3. Implement `src/app/api/v1/fasting/route.ts`:
   - Follow v1 auth + rate limit boilerplate from `src/app/api/v1/food-log/route.ts`
   - Port all query param parsing and validation logic from `src/app/api/fasting/route.ts` — single date mode (with `date`, `clientDate`, live detection using `isToday`/`addDays`) and date range mode (with `from`, `to` validation, ordering check)
   - Replace `session!.userId` with `authResult.userId`
   - Single date: return `conditionalResponse(request, { window, live })`
   - Date range: return `conditionalResponse(request, { windows })`
   - Error handling: separate catch blocks for each mode, returning `errorResponse("INTERNAL_ERROR", ..., 500)`
4. Run verifier with pattern `"v1/fasting"` (expect pass)

**Notes:**
- Second most complex route after common-foods due to two query modes (single date vs range) and live detection logic. Follow the browser route logic exactly.
- `isToday` and `addDays` are imported from `@/lib/date-utils`.

### Task 5: Add GET /api/v1/earliest-entry endpoint
**Linear Issue:** [FOO-867](https://linear.app/lw-claude/issue/FOO-867/add-get-apiv1earliest-entry-endpoint)
**Files:**
- `src/app/api/v1/earliest-entry/__tests__/route.test.ts` (create)
- `src/app/api/v1/earliest-entry/route.ts` (create)

**Steps:**
1. Write tests in `src/app/api/v1/earliest-entry/__tests__/route.test.ts`:
   - Mock `@/lib/api-auth`, `@/lib/logger`, `@/lib/food-log` (getEarliestEntryDate), `@/lib/rate-limit`
   - Success with data: returns `{ date: "2025-01-15" }` when entries exist
   - Success with no data: returns `{ date: null }` when no entries exist
   - Auth failure: 401
   - Rate limit exceeded: 429
   - Rate limit key: `v1:earliest-entry:hashed-<key>` with 60 req/min
   - Cache-Control: `private, no-cache`
   - ETag + 304 Not Modified
   - Internal error: 500
2. Run verifier with pattern `"v1/earliest-entry"` (expect fail)
3. Implement `src/app/api/v1/earliest-entry/route.ts`:
   - Follow v1 auth + rate limit boilerplate
   - No query params needed — call `getEarliestEntryDate(authResult.userId, log)` directly
   - Return `conditionalResponse(request, { date })`
   - Error handling: catch block returns `errorResponse("INTERNAL_ERROR", "Failed to retrieve earliest entry date", 500)`
4. Run verifier with pattern `"v1/earliest-entry"` (expect pass)

**Notes:**
- Simplest route in the plan — no query params at all, just auth + single DB call.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Expose 5 existing endpoints (food-history, common-foods, search-foods, fasting, earliest-entry) via the external v1 API with Bearer token authentication and rate limiting.
**Linear Issues:** FOO-863, FOO-864, FOO-865, FOO-866, FOO-867
**Approach:** Create 5 new v1 route files mirroring the query logic from their browser-facing counterparts, replacing session auth with `validateApiRequest()` + `checkRateLimit()`. All routes are DB-only (60 req/min). Reuse existing business logic functions from `@/lib/food-log` and `@/lib/fasting` — no new lib code needed. Follow the established v1 route pattern from `src/app/api/v1/food-log/route.ts`.
**Scope:** 5 tasks, 10 files (5 routes + 5 test files), ~45 tests
**Key Decisions:** All five routes are DB-only so they use the 60 req/min rate limit tier. Query param validation logic is ported verbatim from browser routes to maintain identical behavior.
**Risks:** None. Pure wiring — no new business logic, no schema changes, no external API calls.
