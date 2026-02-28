# Implementation Plan

**Created:** 2026-02-28
**Source:** Inline request: Add ETag support to all GET API routes (v1 external + internal browser-facing). Hash the `data` payload to avoid the timestamp problem. Full HTTP spec compliance for `If-None-Match`. Update API.md for external API changes.
**Linear Issues:** [FOO-691](https://linear.app/lw-claude/issue/FOO-691/create-etag-utility-module-and-conditionalresponse-function), [FOO-692](https://linear.app/lw-claude/issue/FOO-692/update-v1-api-routes-with-etag-support), [FOO-693](https://linear.app/lw-claude/issue/FOO-693/update-internal-api-routes-with-etag-support), [FOO-694](https://linear.app/lw-claude/issue/FOO-694/update-apimd-with-etag-and-conditional-requests-documentation)

## Context Gathered

### Codebase Analysis
- **`src/lib/api-response.ts`** — `successResponse()` wraps data in `{ success, data, timestamp }`. The `timestamp: Date.now()` changes every request, so ETags must hash only the `data` portion.
- **`src/lib/__tests__/api-response.test.ts`** — Existing tests for `successResponse` and `errorResponse`.
- **5 v1 routes** under `src/app/api/v1/` — all GET-only, use `validateApiRequest()` + `successResponse()` + manual `Cache-Control: private, no-cache` header.
- **13 internal GET routes** under `src/app/api/` (excluding auth, POST-only, and v1) — use `getSession()` + `validateSession()` + `successResponse()` + manual `Cache-Control: private, no-cache`.
- **`src/app/api/health/route.ts`** — special case: no `request` parameter, no `Cache-Control` header. Needs both added.
- **`src/app/api/nutrition-summary/route.ts`** — has two success paths (single date and date range), each calling `successResponse()` separately.
- **`src/lib/swr.ts`** — `apiFetcher` uses plain `fetch()`, browser HTTP cache handles `If-None-Match` transparently. No frontend changes needed.
- **`API.md`** — documents v1 external API. Needs ETag/conditional request docs.
- **All v1 route test files** follow same pattern: mock dependencies, test success/error/cache-control/rate-limit.

### Test Conventions
- Route tests in `src/app/api/<route>/__tests__/route.test.ts`
- Lib tests in `src/lib/__tests__/<module>.test.ts`
- Mocks use `vi.mock()` with proxy pattern
- Import route handler via `await import()`

## Original Plan

### Task 1: Create ETag utility module and conditionalResponse function
**Linear Issue:** [FOO-691](https://linear.app/lw-claude/issue/FOO-691/create-etag-utility-module-and-conditionalresponse-function)

**Files:**
- `src/lib/etag.ts` (new)
- `src/lib/__tests__/etag.test.ts` (new)
- `src/lib/api-response.ts` (modify)
- `src/lib/__tests__/api-response.test.ts` (modify)

**TDD Steps:**

1. **RED** — Create `src/lib/__tests__/etag.test.ts` with tests for two functions:

   `generateETag(data: unknown): string`:
   - Returns a strong ETag string (format: `"<16 hex chars>"`) — quoted, no `W/` prefix
   - Returns same ETag for same data (deterministic)
   - Returns different ETag for different data
   - Handles null, undefined, empty object, empty array
   - Handles nested objects — same data in same key order produces same ETag

   `etagMatches(ifNoneMatch: string | null, etag: string): boolean`:
   - Returns false when ifNoneMatch is null
   - Returns true for exact match: `"abc123"` matches `"abc123"`
   - Returns true for wildcard: `*` matches any ETag
   - Returns true for multiple values: `"aaa", "bbb", "ccc"` matches `"bbb"`
   - Handles whitespace around commas: `"aaa" , "bbb"` matches `"bbb"`
   - Returns false when no values match
   - Handles weak ETag comparison: `W/"abc"` matches `"abc"` (weak comparison per RFC 9110 §13.1.2)
   - Handles weak ETag in the stored value: `"abc"` matches against `W/"abc"` in If-None-Match

   Run: `npm test -- etag`
   Verify: Tests fail (module doesn't exist)

2. **GREEN** — Create `src/lib/etag.ts`:
   - `generateETag`: Use `crypto.createHash('sha256')` on `JSON.stringify(data)`, truncate hex digest to 16 chars, wrap in double quotes
   - `etagMatches`: Split `ifNoneMatch` on commas, trim whitespace, strip `W/` prefix from both sides for comparison (weak comparison semantics per RFC 9110 §8.8.3.2 — `If-None-Match` uses weak comparison)
   - Run: `npm test -- etag`
   - Verify: All tests pass

3. **RED** — Add tests to `src/lib/__tests__/api-response.test.ts` for new `conditionalResponse` function:

   `conditionalResponse<T>(request: Request, data: T, status?: number): Response`:
   - Returns 200 with JSON body `{ success: true, data, timestamp }` when no `If-None-Match` header
   - Sets `ETag` header on 200 responses
   - Sets `Cache-Control: private, no-cache` on 200 responses
   - Sets `Content-Type: application/json` on 200 responses
   - Returns 304 with no body when `If-None-Match` matches the ETag
   - Sets `ETag` header on 304 responses
   - Sets `Cache-Control: private, no-cache` on 304 responses
   - Does NOT set `Content-Type` on 304 responses (no body)
   - Returns 200 with new ETag when `If-None-Match` does not match
   - ETag is based on `data` only, not on `timestamp` — same data returns same ETag across calls (use `vi.spyOn(Date, 'now')` to return different values, verify ETag stays the same)
   - Defaults to status 200, accepts custom status
   - Run: `npm test -- api-response`
   - Verify: New tests fail

4. **GREEN** — Add `conditionalResponse` to `src/lib/api-response.ts`:
   - Import `generateETag` and `etagMatches` from `@/lib/etag`
   - Build the response using `new Response(JSON.stringify({ success: true, data, timestamp: Date.now() }))` — NOT `Response.json()` — to serialize once for both body and (separately) for the ETag hash
   - The ETag is computed from `generateETag(data)` (data only, not the full envelope)
   - Check `request.headers.get("if-none-match")` via `etagMatches()`
   - If match: return `new Response(null, { status: 304, headers: { ETag, "Cache-Control": "private, no-cache" } })`
   - If no match: return full 200 response with body, ETag, Cache-Control, Content-Type headers
   - Keep existing `successResponse` and `errorResponse` unchanged — they're still used by POST handlers and error paths
   - Run: `npm test -- api-response`
   - Verify: All tests pass

### Task 2: Update v1 API routes with ETag support
**Linear Issue:** [FOO-692](https://linear.app/lw-claude/issue/FOO-692/update-v1-api-routes-with-etag-support)

**Files:**
- `src/app/api/v1/activity-summary/route.ts` (modify)
- `src/app/api/v1/food-log/route.ts` (modify)
- `src/app/api/v1/lumen-goals/route.ts` (modify)
- `src/app/api/v1/nutrition-goals/route.ts` (modify)
- `src/app/api/v1/nutrition-summary/route.ts` (modify)
- All corresponding `__tests__/route.test.ts` files (modify)

**TDD Steps:**

1. **RED** — For each v1 route test file, add 2 new tests:

   **"returns ETag header on success response":**
   - Use existing success mock setup
   - Assert `response.headers.get("ETag")` matches pattern `/^"[a-f0-9]{16}"$/` (strong ETag, 16 hex chars)

   **"returns 304 when If-None-Match matches":**
   - First request: get the response and extract the ETag header value
   - Second request: add `If-None-Match` header with the extracted ETag, same URL and auth
   - Assert second response has status 304
   - Assert second response body is empty (null/empty string)
   - Assert second response has `ETag` header
   - Assert second response has `Cache-Control: private, no-cache`

   Run: `npm test -- v1`
   Verify: New tests fail (routes still use `successResponse`)

2. **GREEN** — Update each v1 route handler:
   - Add import: `conditionalResponse` from `@/lib/api-response` (replace or alongside `successResponse`)
   - Replace the 3-line pattern:
     ```
     const response = successResponse(data);
     response.headers.set("Cache-Control", "private, no-cache");
     return response;
     ```
     with: `return conditionalResponse(request, data);`
   - The `request` parameter is already available in all v1 route `GET(request: Request)` signatures
   - Run: `npm test -- v1`
   - Verify: All tests pass (existing + new)

3. **Cleanup** — Remove now-redundant `Cache-Control` header assertions from existing tests if they duplicate the new ETag tests. Or keep them — they still assert correct behavior. Implementer's judgment.

**Notes:**
- Each v1 route has exactly one `successResponse()` call to replace
- `successResponse` import can be removed if no longer used in the file (v1 routes are GET-only, no POST handlers in the same file)

### Task 3: Update internal API routes with ETag support
**Linear Issue:** [FOO-693](https://linear.app/lw-claude/issue/FOO-693/update-internal-api-routes-with-etag-support)

**Files (13 GET route handlers):**
- `src/app/api/api-keys/route.ts`
- `src/app/api/claude-usage/route.ts`
- `src/app/api/common-foods/route.ts`
- `src/app/api/earliest-entry/route.ts`
- `src/app/api/fasting/route.ts`
- `src/app/api/fitbit-credentials/route.ts`
- `src/app/api/food-history/route.ts`
- `src/app/api/food-history/[id]/route.ts`
- `src/app/api/lumen-goals/route.ts`
- `src/app/api/nutrition-goals/route.ts`
- `src/app/api/nutrition-summary/route.ts`
- `src/app/api/search-foods/route.ts`
- `src/app/api/health/route.ts`
- All corresponding `__tests__/route.test.ts` files

**TDD Steps:**

1. **RED** — For each internal route test file, add 2 new tests (same pattern as Task 2):

   **"returns ETag header on success response":**
   - Use existing success mock setup
   - Assert `response.headers.get("ETag")` matches `/^"[a-f0-9]{16}"$/`

   **"returns 304 when If-None-Match matches":**
   - First call to get ETag, second call with `If-None-Match` → 304
   - Assert 304 status, empty body, ETag present, Cache-Control present

   Run: `npm test -- <route-name>`
   Verify: New tests fail

2. **GREEN** — Update each internal route handler:
   - Import `conditionalResponse` from `@/lib/api-response`
   - Replace `successResponse(data)` + `Cache-Control` header with `conditionalResponse(request, data)`

   **Special cases:**
   - **`health/route.ts`:** Currently `GET()` has no `request` parameter. Add it: `GET(request: Request)`. Also currently has no `Cache-Control` header — `conditionalResponse` handles this.
   - **`nutrition-summary/route.ts`:** Has TWO success paths (single date at ~L43, date range at ~L107). Both `successResponse()` calls must become `conditionalResponse()`.
   - **Routes with GET + POST** (`lumen-goals`, `fitbit-credentials`): Only update the GET handler. Keep `successResponse` import for the POST handler. Keep `errorResponse` import for error paths.
   - **Routes with GET + DELETE** (`api-keys/[id]`): This file is DELETE-only, skip it.

   Run: `npm test -- <route-name>`
   Verify: All tests pass

**Notes:**
- Internal routes use `getSession()` + `validateSession()` instead of `validateApiRequest()`, but the `request` parameter is already in the `GET(request: Request)` signature for all routes except `health`
- The `request` object is already being used to read `searchParams` in most routes, confirming it's in scope

### Task 4: Update API.md documentation
**Linear Issue:** [FOO-694](https://linear.app/lw-claude/issue/FOO-694/update-apimd-with-etag-and-conditional-requests-documentation)

**Files:**
- `API.md` (modify)

**Steps:**

1. Add a new section "Conditional Requests (ETags)" after the "Response Format" section (before "Rate Limiting"):
   - Explain that all GET endpoints return an `ETag` header
   - Document the `If-None-Match` request header
   - Explain 304 Not Modified behavior (no body, ETag echoed back)
   - Explain that `Cache-Control: private, no-cache` means "cache but always revalidate" — ideal for ETag usage
   - Include example request/response flow (first request → 200 + ETag, subsequent → If-None-Match → 304)
   - Note: ETag is based on response data content, not timestamp

2. Update the "Response Format" section:
   - Add `ETag` to the list of headers on success responses
   - Mention 304 as a possible response status

3. No changes needed to individual endpoint docs — ETag behavior is uniform across all endpoints

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Add ETag support with full HTTP spec compliance to all GET API routes (v1 external + internal browser-facing)

**Request:** Implement ETags by hashing the data payload (avoiding timestamp in response envelope). Full If-None-Match spec compliance (multiple values, wildcard, weak comparison). Apply to both v1 and internal API routes. Update API.md docs.

**Linear Issues:** FOO-691, FOO-692, FOO-693, FOO-694

**Approach:** Create an ETag utility module (`generateETag`, `etagMatches`) and a `conditionalResponse` function in `api-response.ts` that replaces the existing `successResponse() + Cache-Control` pattern. Apply uniformly to all 18 GET route handlers. Browser clients (SWR) benefit transparently — no frontend code changes needed since `fetch()` handles `If-None-Match` automatically with `Cache-Control: private, no-cache`.

**Scope:**
- Tasks: 4
- Files affected: ~41 (2 new, ~39 modified)
- New tests: yes (2 new test files, ~36 new test cases across existing test files)

**Key Decisions:**
- ETag hashes only the `data` payload (via `JSON.stringify`), not the full `{ success, data, timestamp }` envelope — avoids timestamp changing the hash every request
- Strong ETags (not weak) — we control serialization, byte-for-byte reproducibility is guaranteed
- SHA-256 truncated to 16 hex chars (64 bits of entropy) — collision-free for practical purposes, compact headers
- `conditionalResponse` replaces the 3-line `successResponse() + headers.set() + return` pattern with a single call
- `successResponse` and `errorResponse` kept unchanged for POST handlers and error paths
- No frontend changes needed — browser HTTP cache + SWR work transparently

**Risks/Considerations:**
- JSON serialization order: `JSON.stringify` preserves insertion order. All data comes from consistent DB query → mapping pipelines, so order is deterministic. No sorted-keys needed.
- `health` route needs `request` parameter added to its `GET()` signature
- `nutrition-summary` internal route has two success paths (single date + date range) — both need updating
