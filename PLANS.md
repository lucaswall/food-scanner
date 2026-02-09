# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-288-per-user-fitbit-credentials
**Issues:** FOO-288, FOO-289, FOO-290, FOO-291, FOO-292, FOO-293
**Created:** 2026-02-09
**Last Updated:** 2026-02-09

## Summary

Implement per-user Fitbit app credentials (database storage, encrypted secrets, onboarding flow, settings management), improve Fitbit connection error UX on the dashboard, and make local DB failures real errors in food log operations.

The issues form two groups:
1. **Per-user Fitbit credentials** (FOO-288 → FOO-290 → FOO-289, FOO-291, FOO-292): Foundation → wiring → UI. Enables multiple household members to use the app with their own Fitbit Personal app.
2. **DB error handling** (FOO-293): Independent improvement to treat local DB as authoritative.

## Issues

### FOO-288: Per-user Fitbit app credentials — database storage and encryption

**Priority:** High
**Labels:** Feature
**Description:** The app uses global `FITBIT_CLIENT_ID` and `FITBIT_CLIENT_SECRET` env vars. Personal apps restrict OAuth to the developer's own account, so only one user can connect Fitbit. Multiple household members need their own Personal app credentials. Add a `fitbit_credentials` table with encrypted client secret storage using existing AES-256-GCM encryption.

**Acceptance Criteria:**
- [ ] New `fitbit_credentials` table with `userId` (unique), `fitbitClientId`, `encryptedClientSecret`, `createdAt`, `updatedAt`
- [ ] Lib module for CRUD operations with automatic encryption/decryption of client secret
- [ ] Drizzle migration generated (never hand-written)
- [ ] `FITBIT_CLIENT_ID` and `FITBIT_CLIENT_SECRET` removed from `REQUIRED_ENV_VARS`, `.env.sample`, and Railway environments

### FOO-290: Use per-user Fitbit credentials in OAuth and API calls

**Priority:** High
**Labels:** Feature
**Description:** `buildFitbitAuthUrl`, `exchangeFitbitCode`, `refreshFitbitToken`, and `ensureFreshToken` all read credentials from env vars. They need to use per-user credentials from the database instead.

**Acceptance Criteria:**
- [ ] `buildFitbitAuthUrl` accepts `clientId` parameter
- [ ] `exchangeFitbitCode` accepts `{ clientId, clientSecret }` parameter
- [ ] `refreshFitbitToken` accepts `{ clientId, clientSecret }` parameter
- [ ] `ensureFreshToken` loads credentials from DB and passes them through
- [ ] Fitbit OAuth routes (`/api/auth/fitbit`, `/api/auth/fitbit/callback`) load user credentials before calling Fitbit functions
- [ ] Error when credentials are missing returns clear error code

### FOO-289: Fitbit credentials onboarding screen after Google login

**Priority:** High
**Labels:** Feature
**Description:** New users who complete Google login have no way to provide their Fitbit Personal app credentials. Google callback redirects straight to Fitbit OAuth. An intermediate onboarding page is needed.

**Acceptance Criteria:**
- [ ] New page `/app/setup-fitbit` with form for Client ID + Client Secret
- [ ] API route `POST /api/fitbit-credentials` to validate, encrypt, and store credentials
- [ ] API route `GET /api/fitbit-credentials` to return client ID only (never the secret)
- [ ] Google callback redirects to `/app/setup-fitbit` when user has no stored credentials
- [ ] After saving credentials, redirects to Fitbit OAuth flow
- [ ] Mobile-first design, 44px touch targets
- [ ] `loading.tsx` skeleton for the setup page

### FOO-292: Show clear error when Fitbit credentials are missing

**Priority:** High
**Labels:** Improvement
**Description:** The `/app` dashboard only checks session existence, not `fitbitConnected`. Users with no Fitbit setup see the full UI but every action fails silently.

**Acceptance Criteria:**
- [ ] Dashboard detects missing Fitbit connection and shows actionable banner
- [ ] Session API returns `hasFitbitCredentials` alongside `fitbitConnected`
- [ ] Banner distinguishes "no credentials" (→ setup page) vs "credentials but no tokens" (→ reconnect)
- [ ] Banner is prominent but doesn't block the UI completely

### FOO-291: Settings page — edit Fitbit Client ID and replace Client Secret

**Priority:** Medium
**Labels:** Feature
**Description:** Users need to view/update Fitbit app credentials after initial setup. Client ID editable in place, Client Secret replaceable only (never displayed).

**Acceptance Criteria:**
- [ ] New "Fitbit App Credentials" section in Settings
- [ ] Client ID shown in editable text input with Save button
- [ ] Client Secret shown as masked (`••••••••`) with "Replace Secret" button
- [ ] API route `PATCH /api/fitbit-credentials` to update credentials
- [ ] After changing credentials, prompt to re-authorize Fitbit
- [ ] Mobile-first design, 44px touch targets

### FOO-293: Treat local DB failures as real errors in food log operations

**Priority:** High
**Labels:** Improvement
**Description:** API routes swallow DB errors and return success with `dbError: true`. The local DB is now authoritative and silent failures cause data loss (entries don't appear in history, detail pages, or food matching).

**Acceptance Criteria:**
- [ ] Log-food route: DB failure after Fitbit success triggers compensation (roll back Fitbit log), returns error
- [ ] Delete route: DB failure after Fitbit delete returns error (with warning about orphaned state)
- [ ] `FoodLogResponse.dbError` field removed from type
- [ ] New `PARTIAL_ERROR` error code for cases where compensation itself fails
- [ ] Existing tests updated to expect errors instead of success+dbError
- [ ] Client-side handling updated if needed (currently `dbError` is ignored)

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Database migrations are up to date
- [ ] All existing tests pass

## Implementation Tasks

### Task 1: Add `fitbit_credentials` table to schema

**Issue:** FOO-288
**Files:**
- `src/db/schema.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing test:
   - No test needed for schema definition — Drizzle validates at migration generation time
   - This task is schema-only; the lib module (Task 2) tests the actual behavior

2. **GREEN** - Add the table definition:
   - Add to `src/db/schema.ts`:
     ```ts
     export const fitbitCredentials = pgTable("fitbit_credentials", {
       id: serial("id").primaryKey(),
       userId: uuid("user_id").notNull().references(() => users.id).unique(),
       fitbitClientId: text("fitbit_client_id").notNull(),
       encryptedClientSecret: text("encrypted_client_secret").notNull(),
       createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
       updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
     });
     ```
   - Pattern: mirrors `fitbitTokens` table structure (serial id, unique userId FK, timestamps)

3. **REFACTOR** - None needed.

**Notes:**
- Client ID stored in plaintext — it's visible in OAuth URLs, not truly secret
- Client Secret encrypted via existing `token-encryption.ts` (AES-256-GCM with SESSION_SECRET)
- `userId` is unique (1:1 with users) — each user has at most one set of Fitbit credentials
- **Migration note:** New table, no data migration needed. After deployment, existing user must re-enter Fitbit credentials through onboarding flow.

---

### Task 2: Create `fitbit-credentials` lib module

**Issue:** FOO-288
**Files:**
- `src/lib/fitbit-credentials.ts` (create)
- `src/lib/__tests__/fitbit-credentials.test.ts` (create)

**TDD Steps:**

1. **RED** - Write failing tests in `src/lib/__tests__/fitbit-credentials.test.ts`:
   - Test `saveFitbitCredentials(userId, clientId, clientSecret)` stores encrypted secret
   - Test `getFitbitCredentials(userId)` returns `{ clientId, clientSecret }` with decrypted secret
   - Test `getFitbitCredentials(userId)` returns `null` when no credentials exist
   - Test `updateFitbitClientId(userId, newClientId)` updates only the client ID
   - Test `replaceFitbitClientSecret(userId, newSecret)` re-encrypts with new secret
   - Test `hasFitbitCredentials(userId)` returns boolean
   - Test `deleteFitbitCredentials(userId)` removes the row
   - Mock `getDb()` and `encryptToken`/`decryptToken` following `src/lib/__tests__/fitbit-tokens.test.ts` patterns
   - Run: `npm test -- fitbit-credentials`
   - Verify: All tests fail (module doesn't exist)

2. **GREEN** - Create `src/lib/fitbit-credentials.ts`:
   - Import from `@/db/index`, `@/db/schema`, `@/lib/token-encryption`
   - Implement all functions using Drizzle queries
   - `saveFitbitCredentials`: upsert (insert with onConflictDoUpdate on userId)
   - `getFitbitCredentials`: select + decrypt client secret
   - Pattern: follows `src/lib/fitbit-tokens.ts` exactly (same encryption, same query patterns)
   - Run: `npm test -- fitbit-credentials`
   - Verify: All tests pass

3. **REFACTOR** - Extract shared patterns if any overlap with fitbit-tokens module.

**Notes:**
- Reference: `src/lib/fitbit-tokens.ts` for encryption/decryption pattern
- Reference: `src/lib/token-encryption.ts` for `encryptToken`/`decryptToken`

---

### Task 3: Generate Drizzle migration

**Issue:** FOO-288
**Files:**
- `drizzle/` (generated files — never hand-write)

**Steps:**

1. Run `npx drizzle-kit generate`
2. Verify a new migration SQL file was created in `drizzle/`
3. Verify the migration creates the `fitbit_credentials` table
4. Run: `npm run typecheck` to ensure schema types are consistent

**Notes:**
- `drizzle-kit generate` does NOT need a live DB — it diffs `schema.ts` against the previous snapshot locally
- **IMPORTANT: Never hand-write migration files or snapshots**
- This task MUST be done by the lead, not a worker (workers must not run CLI generators)

---

### Task 4: Refactor Fitbit OAuth functions to accept credentials

**Issue:** FOO-290
**Depends on:** Task 2
**Files:**
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify — if exists, or create)

**TDD Steps:**

1. **RED** - Update/write tests:
   - Test `buildFitbitAuthUrl(state, redirectUri, clientId)` uses provided clientId
   - Test `exchangeFitbitCode(code, redirectUri, { clientId, clientSecret })` uses provided credentials in Basic auth header
   - Test `refreshFitbitToken(refreshToken, { clientId, clientSecret })` uses provided credentials
   - Test `ensureFreshToken(userId)` loads credentials from DB and passes them to `refreshFitbitToken`
   - Test `ensureFreshToken(userId)` throws `FITBIT_CREDENTIALS_MISSING` when no credentials in DB
   - Run: `npm test -- fitbit`
   - Verify: Tests fail (functions still use env vars)

2. **GREEN** - Modify `src/lib/fitbit.ts`:
   - `buildFitbitAuthUrl(state: string, redirectUri: string, clientId: string)` — replace `getRequiredEnv("FITBIT_CLIENT_ID")` with parameter
   - `exchangeFitbitCode(code: string, redirectUri: string, credentials: { clientId: string; clientSecret: string })` — replace both env var calls with parameter
   - `refreshFitbitToken(refreshToken: string, credentials: { clientId: string; clientSecret: string })` — replace both env var calls with parameter
   - `ensureFreshToken(userId: string)`:
     - Import `getFitbitCredentials` from `@/lib/fitbit-credentials`
     - Load credentials at the start
     - If no credentials, throw `new Error("FITBIT_CREDENTIALS_MISSING")`
     - Pass credentials to `refreshFitbitToken` when refreshing
   - Run: `npm test -- fitbit`
   - Verify: All tests pass

3. **REFACTOR** - Define a `FitbitClientCredentials` interface: `{ clientId: string; clientSecret: string }` for reuse across function signatures.

**Notes:**
- `ensureFreshToken` already receives `userId` — it can load credentials alongside tokens
- The `refreshInFlight` deduplication map stays unchanged
- Fitbit Basic auth header = `base64(clientId:clientSecret)` — already implemented, just needs different source

---

### Task 5: Update Fitbit OAuth routes to use per-user credentials

**Issue:** FOO-290
**Depends on:** Task 4
**Files:**
- `src/app/api/auth/fitbit/route.ts` (modify)
- `src/app/api/auth/fitbit/callback/route.ts` (modify)
- `src/app/api/auth/fitbit/__tests__/route.test.ts` (modify)
- `src/app/api/auth/fitbit/callback/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Update tests:
   - `/api/auth/fitbit` tests: mock `getFitbitCredentials` to return credentials, verify `buildFitbitAuthUrl` receives the clientId
   - `/api/auth/fitbit` tests: test that missing credentials returns a redirect to `/app/setup-fitbit` instead of crashing
   - `/api/auth/fitbit/callback` tests: mock `getFitbitCredentials` to return credentials, verify `exchangeFitbitCode` receives them
   - Run: `npm test -- auth/fitbit`
   - Verify: Tests fail

2. **GREEN** - Modify routes:
   - `/api/auth/fitbit/route.ts`:
     - Import `getFitbitCredentials` from `@/lib/fitbit-credentials`
     - After session validation, load credentials for `session.userId`
     - If no credentials, redirect to `/app/setup-fitbit`
     - Pass `credentials.clientId` to `buildFitbitAuthUrl`
   - `/api/auth/fitbit/callback/route.ts`:
     - Import `getFitbitCredentials` from `@/lib/fitbit-credentials`
     - After session validation, load credentials for `dbSession.userId`
     - If no credentials, return error `FITBIT_CREDENTIALS_MISSING`
     - Pass `credentials` object to `exchangeFitbitCode`
   - Run: `npm test -- auth/fitbit`
   - Verify: All tests pass

3. **REFACTOR** - None expected.

**Notes:**
- The `/api/auth/fitbit` route has both GET and POST handlers — both need updating
- Reference: `src/app/api/auth/fitbit/callback/route.ts` for current pattern

---

### Task 6: Remove Fitbit env vars and add new error code

**Issue:** FOO-290
**Depends on:** Task 5
**Files:**
- `src/lib/env.ts` (modify)
- `src/types/index.ts` (modify)
- `.env.sample` (modify)
- `src/lib/__tests__/env.test.ts` (modify — if exists)

**TDD Steps:**

1. **RED** - Update tests:
   - If env validation tests exist, update them to not expect `FITBIT_CLIENT_ID`/`FITBIT_CLIENT_SECRET`
   - Run: `npm test -- env`
   - Verify: Tests fail (still checking for Fitbit env vars)

2. **GREEN** - Make changes:
   - `src/lib/env.ts`: Remove `"FITBIT_CLIENT_ID"` and `"FITBIT_CLIENT_SECRET"` from `REQUIRED_ENV_VARS`
   - `src/types/index.ts`: Add `"FITBIT_CREDENTIALS_MISSING"` to `ErrorCode` union type
   - `.env.sample`: Remove the `FITBIT_CLIENT_ID` and `FITBIT_CLIENT_SECRET` lines and their comment
   - Run: `npm test -- env`
   - Verify: Tests pass

3. **REFACTOR** - None needed.

**Notes:**
- **Migration note:** After deployment, remove `FITBIT_CLIENT_ID` and `FITBIT_CLIENT_SECRET` from Railway production and staging environments. Existing user must re-enter credentials via the new onboarding flow.
- Update `CLAUDE.md` env vars documentation to reflect removal
- Update `DEVELOPMENT.md` if it mentions these env vars

---

### Task 7: Create Fitbit credentials API routes

**Issue:** FOO-289, FOO-291
**Depends on:** Task 2
**Files:**
- `src/app/api/fitbit-credentials/route.ts` (create)
- `src/app/api/fitbit-credentials/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** - Write failing tests:
   - `GET /api/fitbit-credentials`:
     - Returns `{ hasCredentials: true, clientId: "..." }` when credentials exist
     - Returns `{ hasCredentials: false }` when no credentials
     - Returns 401 when no session
   - `POST /api/fitbit-credentials`:
     - Saves credentials and returns success
     - Returns 400 for missing `clientId` or `clientSecret`
     - Returns 400 for empty strings
     - Returns 401 when no session
   - `PATCH /api/fitbit-credentials`:
     - Updates client ID when only `clientId` provided
     - Replaces client secret when only `clientSecret` provided
     - Updates both when both provided
     - Returns 400 when neither provided
     - Returns 404 when no existing credentials to update
     - Returns 401 when no session
   - Run: `npm test -- fitbit-credentials`
   - Verify: All tests fail (route doesn't exist)

2. **GREEN** - Create `src/app/api/fitbit-credentials/route.ts`:
   - `GET`: Load credentials, return `{ hasCredentials, clientId }` (never return secret)
   - `POST`: Validate body `{ clientId: string, clientSecret: string }`, call `saveFitbitCredentials`, return success
   - `PATCH`: Validate body (at least one of `clientId`/`clientSecret`), call `updateFitbitClientId` and/or `replaceFitbitClientSecret`
   - All handlers: session validation, standardized error responses
   - Cache-Control: `private, no-cache`
   - Run: `npm test -- fitbit-credentials`
   - Verify: All tests pass

3. **REFACTOR** - Extract validation logic if body parsing is duplicated.

**Notes:**
- Pattern: follows existing API routes (session validation, `successResponse`/`errorResponse`)
- Never return the client secret in any response
- The POST handler is used by onboarding (FOO-289), PATCH by settings (FOO-291)

---

### Task 8: Create setup-fitbit onboarding page

**Issue:** FOO-289
**Depends on:** Task 7
**Files:**
- `src/app/app/setup-fitbit/page.tsx` (create)
- `src/app/app/setup-fitbit/loading.tsx` (create)
- `src/components/fitbit-setup-form.tsx` (create)
- `src/components/__tests__/fitbit-setup-form.test.tsx` (create)
- `src/app/app/setup-fitbit/__tests__/page.test.tsx` (create)

**TDD Steps:**

1. **RED** - Write failing tests:
   - `fitbit-setup-form.test.tsx`:
     - Renders Client ID and Client Secret input fields
     - Submit button is disabled when fields are empty
     - Calls `POST /api/fitbit-credentials` on submit
     - Shows loading state during submission
     - Redirects to `/api/auth/fitbit` on success
     - Shows error message on failure
   - `page.test.tsx`:
     - Renders the setup form for authenticated users
     - Redirects to `/` if no session
   - Run: `npm test -- setup-fitbit`
   - Verify: Tests fail

2. **GREEN** - Create the components:
   - `src/components/fitbit-setup-form.tsx` (`'use client'`):
     - Form with two inputs: "Fitbit Client ID" and "Fitbit Client Secret"
     - Client Secret input uses `type="password"`
     - Submit button: "Connect Fitbit"
     - On submit: POST to `/api/fitbit-credentials`, then redirect to `/api/auth/fitbit`
     - Error state for API failures
     - Instructions text: explain where to find these values in Fitbit developer console
   - `src/app/app/setup-fitbit/page.tsx` (Server Component):
     - Session check, redirect if not authenticated
     - Render `FitbitSetupForm`
     - Title: "Set Up Fitbit"
   - `src/app/app/setup-fitbit/loading.tsx`:
     - Skeleton matching the form layout
   - Mobile-first, 44px touch targets on all interactive elements
   - Run: `npm test -- setup-fitbit`
   - Verify: Tests pass

3. **REFACTOR** - Ensure consistent styling with other app pages.

**Notes:**
- Reference: `src/app/settings/page.tsx` for page pattern (Server Component with session check)
- Reference: `src/components/settings-content.tsx` for card styling pattern
- The page is under `/app/` so it's protected by middleware (requires session)
- Include a brief help text explaining that each Fitbit user needs their own "Personal" app from dev.fitbit.com

---

### Task 9: Update Google callback redirect flow

**Issue:** FOO-289
**Depends on:** Task 8
**Files:**
- `src/app/api/auth/google/callback/route.ts` (modify)
- `src/app/api/auth/google/callback/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Update tests:
   - Test: user with no Fitbit credentials AND no tokens → redirect to `/app/setup-fitbit`
   - Test: user with Fitbit credentials but no tokens → redirect to `/api/auth/fitbit`
   - Test: user with Fitbit tokens → redirect to `/app`
   - Run: `npm test -- google/callback`
   - Verify: New tests fail (callback doesn't check credentials)

2. **GREEN** - Modify `src/app/api/auth/google/callback/route.ts`:
   - Import `hasFitbitCredentials` from `@/lib/fitbit-credentials`
   - After line 82 (`getFitbitTokens`), check credentials:
     ```ts
     const fitbitTokens = await getFitbitTokens(user.id);
     if (fitbitTokens) {
       return Response.redirect(buildUrl("/app"), 302);
     }
     const hasCredentials = await hasFitbitCredentials(user.id);
     const redirectTo = hasCredentials ? "/api/auth/fitbit" : "/app/setup-fitbit";
     return Response.redirect(buildUrl(redirectTo), 302);
     ```
   - Run: `npm test -- google/callback`
   - Verify: All tests pass

3. **REFACTOR** - None needed.

**Notes:**
- The three-way redirect: tokens → /app, credentials only → fitbit OAuth, nothing → setup page
- This replaces the current two-way redirect (tokens → /app, no tokens → /api/auth/fitbit)

---

### Task 10: Add `hasFitbitCredentials` to session and show dashboard banner

**Issue:** FOO-292
**Depends on:** Task 2
**Files:**
- `src/types/index.ts` (modify)
- `src/lib/session.ts` (modify)
- `src/app/api/auth/session/route.ts` (modify)
- `src/components/fitbit-status-banner.tsx` (create)
- `src/app/app/page.tsx` (modify)
- `src/components/__tests__/fitbit-status-banner.test.tsx` (create)
- `src/lib/__tests__/session.test.ts` (modify)
- `src/app/api/auth/session/__tests__/route.test.ts` (modify)
- `src/app/app/__tests__/page.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Write/update tests:
   - `session.test.ts`: Test `getSession()` returns `hasFitbitCredentials: true/false`
   - `session route test`: Test response includes `hasFitbitCredentials`
   - `fitbit-status-banner.test.tsx`:
     - Renders nothing when Fitbit is fully connected
     - Shows "Set up Fitbit" banner with link to `/app/setup-fitbit` when no credentials
     - Shows "Reconnect Fitbit" banner with link to reconnect when credentials exist but not connected
   - `page.test.tsx`: Test that dashboard renders the `FitbitStatusBanner` component
   - Run: `npm test -- session fitbit-status-banner page`
   - Verify: New tests fail

2. **GREEN** - Implement:
   - `src/types/index.ts`: Add `hasFitbitCredentials: boolean` to `FullSession` interface
   - `src/lib/session.ts`:
     - Import `hasFitbitCredentials` from `@/lib/fitbit-credentials`
     - In `getSession()`, query credentials: `const hasCredentials = await hasFitbitCredentials(dbSession.userId);`
     - Add to return object: `hasFitbitCredentials: hasCredentials`
   - `src/app/api/auth/session/route.ts`: Add `hasFitbitCredentials` to response
   - `src/components/fitbit-status-banner.tsx` (`'use client'`):
     - Uses `useSWR` to fetch `/api/auth/session`
     - If `!fitbitConnected && !hasFitbitCredentials`: amber banner → "Set up Fitbit to start logging food" + link to `/app/setup-fitbit`
     - If `!fitbitConnected && hasFitbitCredentials`: amber banner → "Fitbit disconnected" + "Reconnect" button (POST to `/api/auth/fitbit`)
     - If `fitbitConnected`: render nothing
   - `src/app/app/page.tsx`: Add `<FitbitStatusBanner />` below the heading
   - Run: `npm test -- session fitbit-status-banner page`
   - Verify: All tests pass

3. **REFACTOR** - Ensure banner styles match the card design system used elsewhere.

**Notes:**
- Reference: `src/components/settings-content.tsx` for SWR + session pattern
- The banner is a client component because it fetches session data via SWR
- Use amber/warning colors for the banner (not destructive red — it's informational)
- The `getSession()` change adds one extra DB query per request — acceptable for single-user app

---

### Task 11: Add credentials management to Settings

**Issue:** FOO-291
**Depends on:** Task 7, Task 10
**Files:**
- `src/components/settings-content.tsx` (modify)
- `src/components/__tests__/settings-content.test.tsx` (modify or create)
- `src/app/settings/__tests__/page.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Write/update tests:
   - Test: Settings page renders "Fitbit App Credentials" section when credentials exist
   - Test: Client ID shown in editable input with current value
   - Test: Client Secret shown as "••••••••" with "Replace Secret" button
   - Test: Clicking Save on Client ID calls `PATCH /api/fitbit-credentials` with `{ clientId }`
   - Test: Clicking "Replace Secret" shows password input, submit calls PATCH with `{ clientSecret }`
   - Test: After successful credential update, shows "Re-authorize Fitbit" prompt
   - Test: When no credentials, shows "No Fitbit credentials configured" with link to setup page
   - Run: `npm test -- settings`
   - Verify: New tests fail

2. **GREEN** - Modify `src/components/settings-content.tsx`:
   - Add SWR call to `GET /api/fitbit-credentials` for credential data
   - New section "Fitbit App Credentials" between connection status and appearance:
     - If no credentials: "No Fitbit credentials configured" + link to `/app/setup-fitbit`
     - If credentials exist:
       - Client ID: text input (editable) + Save button
       - Client Secret: masked display + "Replace Secret" button
       - "Replace Secret" toggles a password input + Save button
       - After any save, show a "Re-authorize Fitbit" link/button
   - Use `fetch` for PATCH calls (not SWR — it's a mutation)
   - Mobile-first, 44px touch targets
   - Run: `npm test -- settings`
   - Verify: All tests pass

3. **REFACTOR** - Extract credential form into a separate component if settings-content becomes too large.

**Notes:**
- Reference: existing card styling in `settings-content.tsx`
- The "Re-authorize" prompt is important because changing credentials invalidates the current Fitbit OAuth tokens
- Secret replacement pattern: never show the actual secret, only allow entering a new one

---

### Task 12: Treat DB failures as real errors in food log operations

**Issue:** FOO-293
**Depends on:** None (independent)
**Files:**
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/food-history/[id]/route.ts` (modify)
- `src/types/index.ts` (modify)
- `src/app/api/log-food/__tests__/route.test.ts` (modify)
- `src/app/api/food-history/[id]/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Update tests:
   - `log-food route.test.ts`:
     - **Remove** the 4 existing `dbError` tests (lines ~529-611)
     - **Add**: When `insertCustomFood` fails after Fitbit success → attempts to delete Fitbit log (compensation) → returns `INTERNAL_ERROR` with message "Food logged to Fitbit but local save failed. Fitbit log was rolled back."
     - **Add**: When `insertFoodLogEntry` fails after Fitbit success → attempts to delete Fitbit log (compensation) → returns `INTERNAL_ERROR`
     - **Add**: When DB fails AND compensation (Fitbit delete) also fails → returns `PARTIAL_ERROR` with message indicating Fitbit has the entry but local DB does not
     - **Add**: When `insertFoodLogEntry` fails in reuse flow → same compensation pattern
     - **Add**: In dry-run mode, DB failure still returns error (no Fitbit to compensate, just error)
   - `food-history/[id] route.test.ts`:
     - **Add**: When `deleteFoodLogEntry` fails after Fitbit delete → returns `INTERNAL_ERROR` with message "Fitbit log deleted but local delete failed"
   - Run: `npm test -- log-food food-history`
   - Verify: New tests fail, old dbError tests removed

2. **GREEN** - Modify routes:
   - `src/types/index.ts`:
     - Add `"PARTIAL_ERROR"` to `ErrorCode` union
     - Remove `dbError?: boolean` from `FoodLogResponse`
   - `src/app/api/log-food/route.ts` — New food flow (lines ~262-297):
     - Remove try/catch around DB operations
     - Instead, wrap in try/catch that does compensation:
       ```ts
       try {
         const customFoodResult = await insertCustomFood(...);
         const logEntryResult = await insertFoodLogEntry(...);
         foodLogId = logEntryResult.id;
       } catch (dbErr) {
         logger.error({ ... }, "DB write failed after Fitbit success, attempting compensation");
         if (fitbitLogId && !isDryRun) {
           try {
             const accessToken = await ensureFreshToken(session!.userId);
             await deleteFoodLog(accessToken, fitbitLogId);
             logger.info({ ... }, "Fitbit log rolled back after DB failure");
           } catch (compensationErr) {
             logger.error({ ... }, "CRITICAL: Fitbit log exists but DB write failed and compensation failed");
             return errorResponse("PARTIAL_ERROR", "Food logged to Fitbit but local save failed. Manual cleanup may be needed.", 500);
           }
         }
         return errorResponse("INTERNAL_ERROR", "Failed to save food log", 500);
       }
       ```
   - `src/app/api/log-food/route.ts` — Reuse flow (lines ~193-211): Same compensation pattern
   - `src/app/api/food-history/[id]/route.ts` — Delete (lines ~69-76):
     - Remove inner try/catch
     - If `deleteFoodLogEntry` throws, return error:
       ```ts
       try {
         await deleteFoodLogEntry(session!.userId, id);
       } catch (dbErr) {
         logger.error({ ... }, "Fitbit delete succeeded but local DB delete failed");
         return errorResponse("INTERNAL_ERROR", "Fitbit log deleted but local delete failed. Entry may be orphaned.", 500);
       }
       ```
   - Remove all `dbError` variable declarations and usages
   - Remove `...(dbError && { dbError: true })` from response objects
   - Run: `npm test -- log-food food-history`
   - Verify: All tests pass

3. **REFACTOR** - Extract compensation logic into a helper function if the pattern is repeated more than twice.

**Notes:**
- Compensation approach: if DB fails after Fitbit succeeds, try to roll back the Fitbit operation
- If compensation also fails, return `PARTIAL_ERROR` so the client knows the state is inconsistent
- For dry-run mode: no Fitbit to compensate, just return the DB error
- The delete route is simpler: no compensation possible (Fitbit log already deleted), just report the error
- Client-side: `dbError` was never checked (grep confirmed no usage in `src/components/`), so no client changes needed

---

### Task 13: Update documentation

**Issue:** FOO-288, FOO-290, FOO-292, FOO-293
**Depends on:** Tasks 1-12
**Files:**
- `CLAUDE.md` (modify)
- `.env.sample` (already modified in Task 6)
- `DEVELOPMENT.md` (modify if needed)
- `MIGRATIONS.md` (modify)

**Steps:**

1. Update `CLAUDE.md`:
   - Remove `FITBIT_CLIENT_ID` and `FITBIT_CLIENT_SECRET` from env vars documentation
   - Add `fitbit_credentials` to the database tables list
   - Add `FITBIT_CREDENTIALS_MISSING` and `PARTIAL_ERROR` to error codes if documented
   - Update any references to global Fitbit credentials

2. Update `MIGRATIONS.md`:
   - Add entry: "Per-user Fitbit credentials (FOO-288): New `fitbit_credentials` table. After deployment, remove `FITBIT_CLIENT_ID` and `FITBIT_CLIENT_SECRET` from Railway env vars. Existing user must re-enter Fitbit credentials through the new setup flow at `/app/setup-fitbit`."

3. Update `DEVELOPMENT.md` if it mentions Fitbit env vars.

---

### Task 14: Integration & Verification

**Issue:** FOO-288, FOO-289, FOO-290, FOO-291, FOO-292, FOO-293
**Depends on:** Tasks 1-13
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification steps:
   - [ ] All tests pass with zero failures
   - [ ] Zero lint warnings
   - [ ] Zero TypeScript errors
   - [ ] Build completes successfully
   - [ ] No references to `FITBIT_CLIENT_ID` or `FITBIT_CLIENT_SECRET` remain in env.ts or env.sample
   - [ ] `FoodLogResponse` type no longer has `dbError` field
   - [ ] `ErrorCode` includes `FITBIT_CREDENTIALS_MISSING` and `PARTIAL_ERROR`

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |
| Linear | `create_comment` | Add progress notes to issues if needed |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| No Fitbit credentials in DB | `FITBIT_CREDENTIALS_MISSING` error / redirect to setup | Unit test |
| Invalid credentials format (empty) | 400 validation error | Unit test |
| DB write fails after Fitbit success | Compensate (delete Fitbit log), return `INTERNAL_ERROR` | Unit test |
| DB write + compensation both fail | Return `PARTIAL_ERROR` | Unit test |
| Fitbit OAuth with no credentials | Redirect to `/app/setup-fitbit` | Unit test |
| Session missing | 401 AUTH_MISSING_SESSION | Unit test |

## Risks & Open Questions

- [ ] **Deployment ordering:** Removing env vars before users have entered DB credentials means a brief window where Fitbit operations fail. Mitigation: deploy during low-usage time, existing user re-enters credentials immediately.
- [ ] **Compensation reliability:** Rolling back a Fitbit log on DB failure adds a network call that could itself fail. Mitigation: `PARTIAL_ERROR` code makes the inconsistency visible, and the single-user context makes manual cleanup straightforward.
- [ ] **Session query cost:** Adding `hasFitbitCredentials` query to every `getSession()` call adds one DB query per request. Acceptable for single-user app, but could be optimized later with caching.

## Scope Boundaries

**In Scope:**
- New `fitbit_credentials` table with encrypted storage
- Per-user credentials in all Fitbit OAuth and API functions
- Onboarding page for new users to enter credentials
- Settings page for managing credentials
- Dashboard banner for Fitbit connection status
- DB errors as real errors with compensation logic
- Documentation updates

**Out of Scope:**
- Multi-user onboarding beyond household members
- Fitbit app type validation (checking if the app is actually "Personal")
- Automatic credential migration from env vars to DB
- Service worker / offline support for credential management
- Rate limiting on credential API routes (single-user app)
