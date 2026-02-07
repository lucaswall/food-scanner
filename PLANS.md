# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-213-multi-user-support
**Issues:** FOO-212, FOO-213, FOO-214, FOO-215, FOO-216
**Created:** 2026-02-07
**Last Updated:** 2026-02-07

## Summary

This plan implements multi-user support for the food scanner app and fixes the post-logging navigation UX. The multi-user work (FOO-213 through FOO-216) adds a `users` table, converts the single-email gate to a comma-separated allowlist, and systematically refactors all data-access and API layers from `email` to `userId`. FOO-212 is an independent UX improvement that changes the confirmation button to navigate home.

## Issues

### FOO-212: Change confirmation button to navigate to home after logging food

**Priority:** Medium
**Labels:** Improvement
**Description:** After successfully logging food, the confirmation screen shows a "Log Another" button that calls `onReset` to clear state. Users expect to return to the home screen instead.

**Acceptance Criteria:**
- [ ] Button text changed from "Log Another" to "Done"
- [ ] Clicking "Done" navigates to `/app` (home screen) in both flows
- [ ] Works from photo analysis flow (`/app/analyze`)
- [ ] Works from quick select flow (`/app`)
- [ ] Haptic feedback and success animation remain unchanged

### FOO-213: Multi-user support: add `users` table and replace email-based identity with user IDs

**Priority:** High
**Labels:** Feature
**Description:** The app uses raw email strings as user identity across all 4 database tables. There is no `users` table. This adds a proper user entity with UUID IDs and adds `userId` FK columns to all existing tables.

**Acceptance Criteria:**
- [ ] `users` table exists with `id` (UUID), `email` (unique), `name`, `createdAt`, `updatedAt`
- [ ] `sessions`, `fitbit_tokens`, `custom_foods`, `food_log_entries` all have `userId` column
- [ ] Migration generated via `npx drizzle-kit generate`
- [ ] Data migration documented in MIGRATIONS.md

### FOO-214: Multi-user support: convert `ALLOWED_EMAIL` to comma-separated allowlist

**Priority:** High
**Labels:** Feature
**Description:** `ALLOWED_EMAIL` env var accepts only a single email. Google OAuth rejects anyone else. Convert to comma-separated `ALLOWED_EMAILS`.

**Acceptance Criteria:**
- [ ] Env var renamed from `ALLOWED_EMAIL` to `ALLOWED_EMAILS`
- [ ] Comma-separated parsing with trim
- [ ] Google OAuth checks allowlist with `includes()`
- [ ] Google OAuth callback creates/retrieves user record on login
- [ ] Documentation updated (CLAUDE.md, README.md, DEVELOPMENT.md)

### FOO-215: Multi-user support: refactor data-access layer from `email` to `userId`

**Priority:** High
**Labels:** Feature
**Description:** All data-access functions use `email: string` as the user identifier. Every DB query filters by `eq(table.email, email)`. Change all to `userId`.

**Acceptance Criteria:**
- [ ] All function signatures in session-db.ts, fitbit-tokens.ts, food-log.ts, food-matching.ts changed from `email` to `userId`
- [ ] All queries updated from `eq(table.email, email)` to `eq(table.userId, userId)`
- [ ] All tests updated to use `userId`

### FOO-216: Multi-user support: update API routes and session interface to use `userId`

**Priority:** High
**Labels:** Feature
**Description:** All ~10 API route handlers extract `session!.email` to pass to data-access functions. `FullSession` exposes `email` as the primary identifier. Change to `userId`.

**Acceptance Criteria:**
- [ ] `FullSession` interface uses `userId: string` (keep `email` for display)
- [ ] `getSession()` returns `userId` from DB session
- [ ] All API routes use `session!.userId` instead of `session!.email`
- [ ] All route handler tests updated

## Prerequisites

- [ ] On `main` branch with clean tree
- [ ] Local Postgres running (`docker compose up -d`)
- [ ] All existing tests pass (`npm test`)

## Implementation Tasks

### Task 1: Change confirmation button to navigate home (FOO-212)

**Issue:** FOO-212
**Files:**
- `src/components/food-log-confirmation.tsx` (modify)
- `src/components/__tests__/food-log-confirmation.test.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify — remove onReset prop usage)
- `src/components/quick-select.tsx` (modify — remove onReset prop usage)

**TDD Steps:**

1. **RED** — Update test for navigation behavior:
   - In `src/components/__tests__/food-log-confirmation.test.tsx`, mock `next/navigation` `useRouter`
   - Add test: "navigates to /app when Done button is clicked"
   - Assert `mockRouter.push` called with `/app`
   - Update existing "Log Another" button test to expect "Done" text instead
   - Run: `npm test -- food-log-confirmation`
   - Verify: Tests fail (button still says "Log Another", no router.push)

2. **GREEN** — Implement navigation:
   - In `src/components/food-log-confirmation.tsx`:
     - Remove `onReset` from props interface
     - Import `useRouter` from `next/navigation`
     - Change button text from "Log Another" to "Done"
     - Change onClick to `router.push('/app')`
   - In `src/components/food-analyzer.tsx`:
     - Remove `onReset={handleReset}` prop from `<FoodLogConfirmation>`
     - Remove the `handleReset` function if no longer used elsewhere
   - In `src/components/quick-select.tsx`:
     - Remove `onReset={handleReset}` prop from `<FoodLogConfirmation>`
     - Keep `handleReset` if it's used elsewhere in the component (for reset-to-list behavior)
   - Run: `npm test -- food-log-confirmation`
   - Verify: Tests pass

3. **REFACTOR** — Clean up:
   - Remove any dead code from removing `onReset` prop
   - Ensure the confirmation component test file has no stale test descriptions

**Notes:**
- The `FoodLogConfirmation` component is already `'use client'`, so `useRouter` is valid
- Navigation away will unmount the parent component, which handles cleanup implicitly
- Reference: existing `useRouter` usage in other client components

---

### Task 2: Add `users` table to schema (FOO-213)

**Issue:** FOO-213
**Files:**
- `src/db/schema.ts` (modify)
- `src/db/__tests__/schema.test.ts` (create)

**TDD Steps:**

1. **RED** — Write schema validation test:
   - Create `src/db/__tests__/schema.test.ts`
   - Import `users` from `@/db/schema`
   - Test that `users` table has expected columns: `id` (UUID, PK), `email` (text, unique, not null), `name` (text), `createdAt` (timestamp), `updatedAt` (timestamp)
   - Run: `npm test -- schema.test`
   - Verify: Test fails (no `users` export)

2. **GREEN** — Add users table:
   - In `src/db/schema.ts`, add before existing tables:
     ```typescript
     export const users = pgTable("users", {
       id: uuid("id").defaultRandom().primaryKey(),
       email: text("email").notNull().unique(),
       name: text("name"),
       createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
       updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
     });
     ```
   - Run: `npm test -- schema.test`
   - Verify: Test passes

3. **REFACTOR** — No refactoring needed.

**Notes:**
- Do NOT run `npx drizzle-kit generate` yet — that happens in Task 3 after adding `userId` FKs
- Reference: existing table patterns in `src/db/schema.ts`

---

### Task 3: Add `userId` FK columns to all existing tables (FOO-213)

**Issue:** FOO-213
**Files:**
- `src/db/schema.ts` (modify)
- `src/db/__tests__/schema.test.ts` (modify)

**TDD Steps:**

1. **RED** — Extend schema tests for userId columns:
   - Add tests that `sessions`, `fitbitTokens`, `customFoods`, `foodLogEntries` each have a `userId` column
   - Test that `userId` references `users.id`
   - Run: `npm test -- schema.test`
   - Verify: Tests fail (no `userId` column)

2. **GREEN** — Add userId to all tables:
   - In `src/db/schema.ts`, add to each table:
     ```typescript
     userId: uuid("user_id").notNull().references(() => users.id),
     ```
   - For `fitbitTokens`: change `.unique()` constraint from `email` to `userId`
   - Run: `npm test -- schema.test`
   - Verify: Tests pass

3. **Generate migration** (lead-only, not a worker task):
   - Run: `npx drizzle-kit generate`
   - Verify migration file created in `drizzle/`
   - Commit migration files

**Migration note:** Production tables `sessions`, `fitbit_tokens`, `custom_foods`, `food_log_entries` all gain a `user_id` column. Existing rows need backfill: create a user record for the existing email, then populate `user_id` in all rows. The `email` columns remain for now (removed in a later task after all code references are updated). Log this in `MIGRATIONS.md`.

**Notes:**
- Keep `email` columns for now — they'll be dropped after code is fully migrated
- Reference: existing FK pattern in schema (there are none currently, this is the first)

---

### Task 4: Add user CRUD functions (FOO-213)

**Issue:** FOO-213
**Files:**
- `src/lib/users.ts` (create)
- `src/lib/__tests__/users.test.ts` (create)

**TDD Steps:**

1. **RED** — Write tests for user CRUD:
   - Create `src/lib/__tests__/users.test.ts`
   - Test `getOrCreateUser(email, name?)`:
     - When user doesn't exist: creates user, returns `{ id, email, name }`
     - When user exists: returns existing user without creating
   - Test `getUserById(userId)`:
     - Returns user or null
   - Use same DB mocking pattern as `src/lib/__tests__/session-db.test.ts`
   - Run: `npm test -- users.test`
   - Verify: Tests fail (module doesn't exist)

2. **GREEN** — Implement user CRUD:
   - Create `src/lib/users.ts`
   - Implement `getOrCreateUser(email: string, name?: string)`:
     - Query `users` table by email
     - If found, return user
     - If not found, insert new user and return it
   - Implement `getUserById(userId: string)`:
     - Query `users` table by id
     - Return user or null
   - Run: `npm test -- users.test`
   - Verify: Tests pass

3. **REFACTOR** — Ensure return types use a proper `User` interface defined in `src/types/index.ts`.

**Notes:**
- `getOrCreateUser` is the key function — called during Google OAuth callback to ensure a user record exists
- Reference: `src/lib/session-db.ts` for DB access patterns, `src/lib/fitbit-tokens.ts` for query patterns

---

### Task 5: Convert ALLOWED_EMAIL to ALLOWED_EMAILS (FOO-214)

**Issue:** FOO-214
**Files:**
- `src/lib/env.ts` (modify)
- `src/lib/__tests__/env.test.ts` (create)
- `CLAUDE.md` (modify)
- `README.md` (modify)
- `DEVELOPMENT.md` (modify)

**TDD Steps:**

1. **RED** — Write tests for allowlist parsing:
   - Create `src/lib/__tests__/env.test.ts`
   - Test `getAllowedEmails()` helper:
     - Single email: `"a@b.com"` → `["a@b.com"]`
     - Multiple emails: `"a@b.com, c@d.com"` → `["a@b.com", "c@d.com"]`
     - Trims whitespace: `" a@b.com , c@d.com "` → `["a@b.com", "c@d.com"]`
     - Filters empty strings: `"a@b.com,,"` → `["a@b.com"]`
   - Test `isEmailAllowed(email)`:
     - Returns true for listed email
     - Returns false for unlisted email
     - Case-insensitive comparison
   - Run: `npm test -- env.test`
   - Verify: Tests fail (functions don't exist)

2. **GREEN** — Implement allowlist:
   - In `src/lib/env.ts`:
     - Rename `ALLOWED_EMAIL` to `ALLOWED_EMAILS` in REQUIRED_ENV_VARS
     - Add `getAllowedEmails()`: splits on comma, trims, filters empty
     - Add `isEmailAllowed(email: string)`: case-insensitive check against allowlist
   - Run: `npm test -- env.test`
   - Verify: Tests pass

3. **REFACTOR** — Update documentation:
   - `CLAUDE.md`: Replace `ALLOWED_EMAIL` with `ALLOWED_EMAILS` in env vars section and security section
   - `README.md`: Update env var documentation
   - `DEVELOPMENT.md`: Update local env setup instructions

**Notes:**
- Reference: `src/lib/env.ts` current pattern for `getRequiredEnv()`
- The `isEmailAllowed` function will be used by the Google OAuth callback in Task 6

---

### Task 6: Update Google OAuth callback for multi-user (FOO-214, FOO-213)

**Issue:** FOO-214, FOO-213
**Files:**
- `src/app/api/auth/google/callback/route.ts` (modify)
- `src/app/api/auth/google/callback/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update OAuth callback tests:
   - Modify existing tests to use `ALLOWED_EMAILS` env var
   - Add test: "allows second email in allowlist"
   - Add test: "creates user record via getOrCreateUser on successful login"
   - Add test: "stores userId in session via createSession(userId)"
   - Run: `npm test -- google/callback`
   - Verify: Tests fail (still using old ALLOWED_EMAIL)

2. **GREEN** — Implement multi-user OAuth:
   - In `src/app/api/auth/google/callback/route.ts`:
     - Replace `getRequiredEnv("ALLOWED_EMAIL")` with `isEmailAllowed(profile.email)` from `src/lib/env.ts`
     - After email check passes, call `getOrCreateUser(profile.email, profile.name)` to get user record
     - Pass `user.id` (not email) to `createSession(user.id)` — but wait, session-db still expects email at this point
     - **Important ordering**: Since we haven't refactored session-db yet (Task 8), this task creates the user record but still passes `email` to `createSession`. Task 8 will switch to `userId`.
     - Actually, to avoid a half-migrated state, we'll pass `userId` here AND update `createSession` in the same task. See Task 8.
   - For now in this task, ONLY update the allowlist check and add the `getOrCreateUser` call. Keep passing `email` to `createSession`.
   - Run: `npm test -- google/callback`
   - Verify: Tests pass

3. **REFACTOR** — Ensure error messages are clear for rejected emails.

**Notes:**
- The full switch to `userId` in session creation happens in Task 8
- Reference: `src/app/api/auth/google/callback/route.ts` current implementation

---

### Task 7: Refactor session-db from email to userId (FOO-215)

**Issue:** FOO-215
**Files:**
- `src/lib/session-db.ts` (modify)
- `src/lib/__tests__/session-db.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update session-db tests:
   - Change all test calls from `createSession("test@example.com")` to `createSession("user-uuid-123")`
   - Update mock assertions to expect `userId` in insert values
   - Run: `npm test -- session-db`
   - Verify: Tests fail (function still expects email)

2. **GREEN** — Refactor session-db:
   - In `src/lib/session-db.ts`:
     - `createSession(email: string)` → `createSession(userId: string)`
     - Insert: `email: email` → `userId: userId`
     - Keep `email` column populated for now (need it during migration period) — actually, since we're adding `userId` column in Task 3, we can write to `userId` here. But existing `email` column is NOT NULL. During the transition, we need to handle both.
     - **Simplification**: Since this is a development project with disposable staging DB and we'll handle prod migration at release time (per CLAUDE.md), just switch to `userId` and stop writing `email`. The NOT NULL constraint on `email` will be dropped in the migration.
   - Actually, the cleaner approach: update the `sessions` schema to make `email` nullable (or remove it), and only write `userId`. But schema changes are in Task 3. Let's keep it simple:
     - Change `createSession` to accept `userId` instead of `email`
     - Update the insert to write `userId` field
     - The `email` column in schema will be made nullable/removed when we drop it later
   - Run: `npm test -- session-db`
   - Verify: Tests pass

3. **REFACTOR** — Ensure consistent naming (userId not user_id in TS).

**Notes:**
- Reference: `src/lib/__tests__/session-db.test.ts` for current test patterns
- The session row returned by `getSessionById` will now have `userId` instead of `email`

---

### Task 8: Update Google OAuth callback to pass userId to createSession (FOO-213, FOO-214)

**Issue:** FOO-213, FOO-214
**Files:**
- `src/app/api/auth/google/callback/route.ts` (modify)
- `src/app/api/auth/google/callback/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update test to verify userId is passed to createSession:
   - Mock `createSession` and assert it receives `user.id` (a UUID) not email
   - Run: `npm test -- google/callback`
   - Verify: Tests fail (still passing email)

2. **GREEN** — Switch to userId:
   - In the callback route, after `getOrCreateUser(profile.email, profile.name)`, call `createSession(user.id)` instead of `createSession(profile.email)`
   - Run: `npm test -- google/callback`
   - Verify: Tests pass

3. **REFACTOR** — Clean up any remaining email references in the callback that are no longer needed.

**Notes:**
- This task depends on Task 6 (getOrCreateUser added) and Task 7 (createSession accepts userId)
- After this task, new sessions are created with userId, not email

---

### Task 9: Refactor fitbit-tokens from email to userId (FOO-215)

**Issue:** FOO-215
**Files:**
- `src/lib/fitbit-tokens.ts` (modify)
- `src/lib/__tests__/fitbit-tokens.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update fitbit-tokens tests:
   - Change all `email` parameters to `userId` (UUID string)
   - Update mock assertions to expect `userId` in queries
   - Run: `npm test -- fitbit-tokens`
   - Verify: Tests fail

2. **GREEN** — Refactor fitbit-tokens:
   - `getFitbitTokens(email)` → `getFitbitTokens(userId: string)`
   - `upsertFitbitTokens(email, data)` → `upsertFitbitTokens(userId: string, data)`
   - `deleteFitbitTokens(email)` → `deleteFitbitTokens(userId: string)`
   - Update all `eq(fitbitTokens.email, email)` → `eq(fitbitTokens.userId, userId)`
   - Run: `npm test -- fitbit-tokens`
   - Verify: Tests pass

3. **REFACTOR** — No additional refactoring needed.

**Notes:**
- Reference: `src/lib/__tests__/fitbit-tokens.test.ts` for current test patterns

---

### Task 10: Refactor food-log from email to userId (FOO-215)

**Issue:** FOO-215
**Files:**
- `src/lib/food-log.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update food-log tests:
   - Change all `email` parameters to `userId` across all test cases
   - Functions to update: `insertCustomFood`, `insertFoodLogEntry`, `getCustomFoodById`, `getCommonFoods`, `getFoodLogHistory`, `getFoodLogEntry`, `deleteFoodLogEntry`
   - Run: `npm test -- food-log.test`
   - Verify: Tests fail

2. **GREEN** — Refactor food-log:
   - Change all function signatures from `email: string` to `userId: string`
   - Change all `eq(customFoods.email, email)` → `eq(customFoods.userId, userId)`
   - Change all `eq(foodLogEntries.email, email)` → `eq(foodLogEntries.userId, userId)`
   - Update insert values from `email` → `userId`
   - Run: `npm test -- food-log.test`
   - Verify: Tests pass

3. **REFACTOR** — No additional refactoring needed.

**Notes:**
- This is the largest file by function count (~8 functions)
- Reference: `src/lib/__tests__/food-log.test.ts` for current patterns

---

### Task 11: Refactor food-matching from email to userId (FOO-215)

**Issue:** FOO-215
**Files:**
- `src/lib/food-matching.ts` (modify)
- `src/lib/__tests__/food-matching.test.ts` (modify if exists, create if not)

**TDD Steps:**

1. **RED** — Update food-matching tests:
   - Change `email` parameter to `userId` in `findMatchingFoods` calls
   - Run: `npm test -- food-matching`
   - Verify: Tests fail

2. **GREEN** — Refactor food-matching:
   - `findMatchingFoods(email, ...)` → `findMatchingFoods(userId: string, ...)`
   - Update query from `eq(customFoods.email, email)` → `eq(customFoods.userId, userId)`
   - Run: `npm test -- food-matching`
   - Verify: Tests pass

3. **REFACTOR** — No additional refactoring needed.

---

### Task 12: Update FullSession interface and getSession() (FOO-216)

**Issue:** FOO-216
**Files:**
- `src/types/index.ts` (modify)
- `src/lib/session.ts` (modify)
- `src/lib/__tests__/session.test.ts` (modify if exists)

**TDD Steps:**

1. **RED** — Update session tests:
   - Test that `getSession()` returns `userId` (UUID) instead of `email`
   - Test that `getSession()` still returns `email` as a secondary field (for display)
   - Run: `npm test -- session.test`
   - Verify: Tests fail

2. **GREEN** — Update FullSession and getSession:
   - In `src/types/index.ts`:
     - Change `FullSession.email` to `FullSession.userId: string`
     - Add `FullSession.email?: string` (optional, for display/logging only)
   - In `src/lib/session.ts`:
     - `getSession()` now reads `dbSession.userId` instead of `dbSession.email`
     - Populate `userId` in returned FullSession
     - Still call `getFitbitTokens(dbSession.userId)` (already refactored in Task 9)
   - Run: `npm test -- session.test`
   - Verify: Tests pass

3. **REFACTOR** — Ensure the `email` field in FullSession is clearly documented as display-only.

**Notes:**
- This changes the interface that all API routes consume
- After this task, `session!.userId` is available and `session!.email` is optional

---

### Task 13: Update all API routes from session.email to session.userId (FOO-216)

**Issue:** FOO-216
**Files:**
- `src/app/api/analyze-food/route.ts` (modify)
- `src/app/api/refine-food/route.ts` (modify)
- `src/app/api/common-foods/route.ts` (modify)
- `src/app/api/find-matches/route.ts` (modify)
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/food-history/route.ts` (modify)
- `src/app/api/food-history/[id]/route.ts` (modify)
- `src/app/api/auth/fitbit/callback/route.ts` (modify)
- All corresponding `__tests__/route.test.ts` files (modify)

**TDD Steps:**

1. **RED** — Update API route tests:
   - In all route test files, change mock session from `{ email: "test@example.com" }` to `{ userId: "user-uuid-123" }`
   - Update assertions that verify email is passed to data functions
   - Run: `npm test`
   - Verify: Tests fail across all route files

2. **GREEN** — Update all routes:
   - In every route handler, replace `session!.email` with `session!.userId`
   - This is a mechanical find-and-replace across all files
   - Key changes:
     - `analyze-food`: `session!.email` → `session!.userId` in logger context
     - `refine-food`: `session!.email` → `session!.userId` in logger context
     - `log-food`: `session!.email` → `session!.userId` for all data function calls
     - `common-foods`: `session!.email` → `session!.userId` for `getCommonFoods()`
     - `find-matches`: `session!.email` → `session!.userId` for `findMatchingFoods()`
     - `food-history`: `session!.email` → `session!.userId` for `getFoodLogHistory()` and `getFoodLogEntry()`
     - `food-history/[id]`: `session!.email` → `session!.userId` for `deleteFoodLogEntry()`
     - `fitbit/callback`: `session!.email` → `session!.userId` for `upsertFitbitTokens()`
   - Run: `npm test`
   - Verify: All tests pass

3. **REFACTOR** — Check for any remaining `session!.email` or `session.email` references in the codebase using grep. Replace any stragglers.

**Notes:**
- This is the widest-reaching task — touches ~8 route files and their tests
- The changes are mechanical (find/replace) but must be thorough
- After this task, no route uses `session!.email` for data access

---

### Task 14: Drop email columns from schema (FOO-213)

**Issue:** FOO-213
**Files:**
- `src/db/schema.ts` (modify)
- `src/db/__tests__/schema.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update schema tests:
   - Remove tests that check for `email` column on `sessions`, `fitbitTokens`, `customFoods`, `foodLogEntries`
   - Add tests that verify these tables do NOT have an `email` column
   - Run: `npm test -- schema.test`
   - Verify: Tests fail (email columns still exist)

2. **GREEN** — Remove email columns:
   - In `src/db/schema.ts`, remove `email` column from:
     - `sessions`
     - `fitbitTokens`
     - `customFoods`
     - `foodLogEntries`
   - Run: `npm test -- schema.test`
   - Verify: Tests pass

3. **Generate migration** (lead-only, not a worker task):
   - Run: `npx drizzle-kit generate`
   - Verify migration file drops email columns
   - Commit migration files

**Migration note:** This drops `email` columns from `sessions`, `fitbit_tokens`, `custom_foods`, `food_log_entries` in production. Must run AFTER the `userId` backfill migration from Task 3. Data migration order: (1) add users table + userId columns, (2) backfill userId from email, (3) drop email columns.

**Notes:**
- This is the final schema cleanup step
- After this, email only exists in the `users` table

---

### Task 15: Integration & Verification

**Issue:** FOO-212, FOO-213, FOO-214, FOO-215, FOO-216
**Files:** Various from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Grep for any remaining `session!.email` or `session\.email` references (should only be in display/logging contexts)
6. Grep for any remaining `eq(*.email,` patterns in data-access files (should be zero)
7. Verify `MIGRATIONS.md` has been updated with all migration notes
8. Manual verification:
   - [ ] Confirmation button says "Done" and navigates to `/app`
   - [ ] `users` table schema is correct
   - [ ] All data-access functions use `userId`
   - [ ] All API routes use `session!.userId`
   - [ ] `ALLOWED_EMAILS` env var documented everywhere
   - [ ] No TypeScript errors

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |
| Linear | `create_comment` | Add progress notes to issues if needed |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Email not in allowlist | 403 with clear error message | Unit test in Google callback |
| User creation fails (DB error) | 500 internal error, no session created | Unit test in users.ts |
| Session with userId not found | Redirect to login | Existing session validation tests |
| Missing ALLOWED_EMAILS env var | Startup validation error | Unit test in env.ts |

## Risks & Open Questions

- [ ] **Migration ordering in production**: The email→userId migration must be done in stages: (1) add columns, (2) backfill, (3) drop old columns. The `push-to-production` skill handles this via MIGRATIONS.md.
- [ ] **Existing sessions after deploy**: After switching to userId-based sessions, all existing sessions will be invalid (they store email, not userId). Users will need to re-login. This is acceptable per CLAUDE.md development policies.

## Scope Boundaries

**In Scope:**
- Confirmation button UX change (FOO-212)
- `users` table + schema migration (FOO-213)
- `ALLOWED_EMAILS` allowlist (FOO-214)
- Data-access layer email→userId refactor (FOO-215)
- API routes + session interface email→userId refactor (FOO-216)
- Documentation updates for env var rename

**Out of Scope:**
- User management UI (invite, remove users)
- Per-user settings or preferences
- Role-based access control
- User profile page
- Email verification
