# Implementation Plan

**Created:** 2026-02-05
**Source:** Inline request: Integrate PostgreSQL database with Drizzle ORM. Add food_logs, sessions, and fitbit_tokens tables. Log food to database on each POST /api/log-food. Move session and Fitbit token persistence from cookie-only to DB-backed. Add sliding session expiration. Update DEVELOPMENT.md with Docker Postgres setup. Update CLAUDE.md with database conventions.
**Linear Issues:** [FOO-112](https://linear.app/lw-claude/issue/FOO-112), [FOO-113](https://linear.app/lw-claude/issue/FOO-113), [FOO-114](https://linear.app/lw-claude/issue/FOO-114), [FOO-115](https://linear.app/lw-claude/issue/FOO-115), [FOO-116](https://linear.app/lw-claude/issue/FOO-116), [FOO-117](https://linear.app/lw-claude/issue/FOO-117), [FOO-118](https://linear.app/lw-claude/issue/FOO-118), [FOO-119](https://linear.app/lw-claude/issue/FOO-119), [FOO-120](https://linear.app/lw-claude/issue/FOO-120), [FOO-121](https://linear.app/lw-claude/issue/FOO-121), [FOO-122](https://linear.app/lw-claude/issue/FOO-122), [FOO-123](https://linear.app/lw-claude/issue/FOO-123)

## Context Gathered

### Codebase Analysis
- **Session management:** `src/lib/session.ts` — iron-session with `getSession()`, `validateSession()`. Cookie holds all data: sessionId, email, createdAt, expiresAt, fitbit tokens.
- **Session consumers:** 8 files import from session.ts — all OAuth callbacks, analyze-food, log-food, auth/session, logout, app/page.tsx, landing page.
- **Food logging:** `src/app/api/log-food/route.ts` → validates body → `ensureFreshToken()` → `findOrCreateFood()` → `logFood()` → returns Fitbit IDs. No local record kept.
- **Token refresh:** `ensureFreshToken()` in `src/lib/fitbit.ts:327-347` mutates session and calls `session.save()`.
- **Middleware:** `middleware.ts` only checks cookie presence (does NOT decrypt/validate).
- **Tests:** All 35+ test files mock `getSession()` directly — migration-safe as long as `getSession()` interface is preserved.
- **No database deps:** No ORM, no DB driver, no Docker files exist.
- **Instrumentation:** `src/instrumentation.ts` — validates env vars at startup, handles graceful shutdown.

### Schema (agreed with user)

**`sessions`** — id (uuid PK), email (text), created_at (timestamp), expires_at (timestamp)

**`fitbit_tokens`** — id (serial PK), email (text), fitbit_user_id (text), access_token (text), refresh_token (text), expires_at (timestamp), updated_at (timestamp)

**`food_logs`** — id (serial PK), email (text), food_name (text), amount (numeric), unit_id (integer), calories (integer), protein_g (numeric), carbs_g (numeric), fat_g (numeric), fiber_g (numeric), sodium_mg (numeric), confidence (text), notes (text), meal_type_id (integer), date (date), time (time nullable), fitbit_food_id (integer), fitbit_log_id (integer), logged_at (timestamp)

## Original Plan

### Task 1: Install Drizzle ORM and PostgreSQL driver
**Linear Issue:** [FOO-112](https://linear.app/lw-claude/issue/FOO-112)

1. Install production deps: `drizzle-orm`, `pg`
2. Install dev deps: `drizzle-kit`, `@types/pg`
3. Create `drizzle.config.ts` at project root:
   - dialect: "postgresql"
   - schema: "./src/db/schema.ts"
   - out: "./drizzle"
   - dbCredentials.url from `DATABASE_URL` env var
4. Add `DATABASE_URL` to `src/lib/env.ts` required vars list
5. Add `DATABASE_URL` to `.env.local` template in DEVELOPMENT.md
6. Run verifier (expect pass — no functional changes yet)

### Task 2: Define database schema
**Linear Issue:** [FOO-113](https://linear.app/lw-claude/issue/FOO-113)

1. Write test in `src/db/__tests__/schema.test.ts`:
   - Import schema tables and verify column definitions exist
   - Verify sessions table has id, email, createdAt, expiresAt
   - Verify fitbitTokens table has id, email, fitbitUserId, accessToken, refreshToken, expiresAt, updatedAt
   - Verify foodLogs table has all expected columns
2. Run verifier (expect fail)
3. Create `src/db/schema.ts`:
   - `sessions` table: id (uuid, defaultRandom, PK), email (text, notNull), createdAt (timestamp, defaultNow), expiresAt (timestamp, notNull)
   - `fitbitTokens` table: id (serial, PK), email (text, notNull), fitbitUserId (text, notNull), accessToken (text, notNull), refreshToken (text, notNull), expiresAt (timestamp, notNull), updatedAt (timestamp, defaultNow)
   - `foodLogs` table: id (serial, PK), email (text, notNull), foodName (text, notNull), amount (numeric, notNull), unitId (integer, notNull), calories (integer, notNull), proteinG (numeric, notNull), carbsG (numeric, notNull), fatG (numeric, notNull), fiberG (numeric, notNull), sodiumMg (numeric, notNull), confidence (text, notNull), notes (text), mealTypeId (integer, notNull), date (date, notNull), time (time), fitbitFoodId (integer), fitbitLogId (integer), loggedAt (timestamp, defaultNow)
4. Run verifier (expect pass)

### Task 3: Create database connection module and migration runner
**Linear Issue:** [FOO-114](https://linear.app/lw-claude/issue/FOO-114)

1. Write test in `src/db/__tests__/index.test.ts`:
   - Test `getDb()` returns a Drizzle instance (mock pg Pool)
   - Test calling `getDb()` twice returns the same instance (singleton)
2. Run verifier (expect fail)
3. Create `src/db/index.ts`:
   - Create a singleton Drizzle client using `drizzle(new Pool({ connectionString: DATABASE_URL }))`
   - Export `getDb()` function
   - Import schema for type-safe queries
4. Create `src/db/migrate.ts`:
   - Import `migrate` from `drizzle-orm/node-postgres/migrator`
   - Export `runMigrations()` that runs migrations from `./drizzle` folder
   - Log migration start/success/failure via pino
5. Wire into `src/instrumentation.ts`:
   - After env validation, call `runMigrations()`
   - If migration fails, log error and exit
6. Run verifier (expect pass)
7. Generate initial migration: `npx drizzle-kit generate`
8. Verify migration SQL files created in `drizzle/` folder

### Task 4: Create docker-compose.yml for local development
**Linear Issue:** [FOO-115](https://linear.app/lw-claude/issue/FOO-115)

1. Create `docker-compose.yml` at project root:
   ```yaml
   services:
     db:
       image: postgres:17-alpine
       ports:
         - "5432:5432"
       environment:
         POSTGRES_USER: postgres
         POSTGRES_PASSWORD: postgres
         POSTGRES_DB: food_scanner
       volumes:
         - pgdata:/var/lib/postgresql/data
   volumes:
     pgdata:
   ```
2. Add to `.gitignore` if not already: no changes needed (docker volumes are not committed)
3. Update `.env.local` template to include:
   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/food_scanner
   ```
4. Run verifier (expect pass)

### Task 5: Refactor session management to DB-backed sessions
**Linear Issue:** [FOO-116](https://linear.app/lw-claude/issue/FOO-116)

1. Write tests in `src/lib/__tests__/session.test.ts`:
   - Test `createSession(email)` inserts a row in sessions table and returns session ID
   - Test `getSessionById(id)` returns session data from DB
   - Test `getSessionById(id)` returns null for expired sessions
   - Test `getSessionById(id)` returns null for non-existent sessions
   - Test `touchSession(id)` extends expiresAt by 30 days from now
   - Test `deleteSession(id)` removes the session row
   - Test `validateSession()` still returns correct error responses (preserve existing interface)
2. Run verifier (expect fail)
3. Refactor `src/lib/session.ts`:
   - Keep iron-session for cookie transport (cookie now only holds `{ sessionId: string }`)
   - Add `createSession(email: string): Promise<string>` — inserts into sessions table, returns UUID
   - Add `getSessionById(id: string): Promise<SessionRow | null>` — queries DB, returns null if expired
   - Add `touchSession(id: string): Promise<void>` — updates expiresAt to now + 30 days
   - Add `deleteSession(id: string): Promise<void>` — deletes row from sessions table
   - Modify `getSession()` to: read sessionId from cookie → query DB → return combined data
   - Keep `validateSession()` interface unchanged — it still checks sessionId, expiresAt, fitbit presence
4. Update `SessionData` type in `src/types/index.ts`:
   - Cookie now only stores: `{ sessionId: string }`
   - Full session data (email, expiresAt, fitbit) comes from DB
   - Create `FullSessionData` interface combining cookie + DB data for route handlers
5. Run verifier (expect pass)

### Task 6: Move Fitbit token storage to database
**Linear Issue:** [FOO-117](https://linear.app/lw-claude/issue/FOO-117)

1. Write tests in `src/lib/__tests__/fitbit-tokens.test.ts`:
   - Test `upsertFitbitTokens(email, tokens)` inserts new row when none exists
   - Test `upsertFitbitTokens(email, tokens)` updates existing row for same email
   - Test `getFitbitTokens(email)` returns tokens from DB
   - Test `getFitbitTokens(email)` returns null when no tokens exist
   - Test `deleteFitbitTokens(email)` removes the row
2. Run verifier (expect fail)
3. Create `src/lib/fitbit-tokens.ts`:
   - `upsertFitbitTokens(email, data)` — insert or update (ON CONFLICT email)
   - `getFitbitTokens(email)` — query by email
   - `deleteFitbitTokens(email)` — delete by email
4. Refactor `ensureFreshToken()` in `src/lib/fitbit.ts`:
   - Instead of reading/writing `session.fitbit`, read/write from `fitbit_tokens` table via `getFitbitTokens()` / `upsertFitbitTokens()`
   - Remove `session.save()` call — tokens are now DB-persisted
   - Accept `email: string` parameter instead of full session object
5. Update callers of `ensureFreshToken()`:
   - `src/app/api/log-food/route.ts`: pass `session.email` instead of session object
   - `src/app/api/analyze-food/route.ts`: same change if applicable
6. Run verifier (expect pass)

### Task 7: Update OAuth callbacks for DB-backed sessions and tokens
**Linear Issue:** [FOO-118](https://linear.app/lw-claude/issue/FOO-118)

1. Write tests in `src/app/api/auth/google/callback/__tests__/route.test.ts`:
   - Test that Google callback calls `createSession(email)` on successful login
   - Test that the cookie is set with only the session ID
   - Test that existing Fitbit tokens are detected via `getFitbitTokens(email)`
2. Write tests in `src/app/api/auth/fitbit/callback/__tests__/route.test.ts`:
   - Test that Fitbit callback calls `upsertFitbitTokens(email, tokens)`
   - Test that session cookie is NOT modified (only DB is updated)
3. Run verifier (expect fail)
4. Update `src/app/api/auth/google/callback/route.ts`:
   - After validating Google profile, call `createSession(email)` instead of setting all session fields
   - Set cookie to `{ sessionId }` only
   - Check `getFitbitTokens(email)` to decide redirect destination (instead of `session.fitbit`)
5. Update `src/app/api/auth/fitbit/callback/route.ts`:
   - Call `upsertFitbitTokens(session.email, { ... })` instead of setting `session.fitbit`
   - No need to call `session.save()` for token changes
6. Update `src/app/api/auth/logout/route.ts`:
   - Call `deleteSession(sessionId)` to remove DB row
   - Keep `session.destroy()` to clear cookie
7. Run verifier (expect pass)

### Task 8: Add sliding session expiration
**Linear Issue:** [FOO-119](https://linear.app/lw-claude/issue/FOO-119)

1. Write test in `src/lib/__tests__/session.test.ts`:
   - Test that `getSession()` (or a wrapper) calls `touchSession()` to extend expiry
   - Test that touch only happens if session is older than 1 hour since last touch (avoid DB write on every request)
2. Run verifier (expect fail)
3. Implement sliding expiration in `src/lib/session.ts`:
   - In `getSession()` (after fetching session from DB): if session exists and `expiresAt` is more than 1 hour closer than 30 days from now, call `touchSession(id)` to reset to 30 days
   - This means: session is extended on any request, but at most once per hour
   - The 1-hour debounce avoids a DB write on every single request
4. Run verifier (expect pass)

### Task 9: Add food logging to database
**Linear Issue:** [FOO-120](https://linear.app/lw-claude/issue/FOO-120)

1. Write tests in `src/lib/__tests__/food-log.test.ts`:
   - Test `insertFoodLog(email, data)` inserts a row with all fields
   - Test returned row has id and loggedAt
   - Test all numeric fields are stored correctly
   - Test nullable fields (time, fitbitFoodId, fitbitLogId) work with null
2. Run verifier (expect fail)
3. Create `src/lib/food-log.ts`:
   - `insertFoodLog(email, data): Promise<{ id: number; loggedAt: Date }>` — inserts into food_logs table
   - Accepts `FoodLogRequest` plus fitbit response data (fitbitFoodId, fitbitLogId)
4. Update `src/app/api/log-food/route.ts`:
   - After successful Fitbit logging, call `insertFoodLog(session.email, { ...body, fitbitFoodId, fitbitLogId })`
   - If DB insert fails, log error but still return success (Fitbit logging succeeded — the primary operation)
   - Include `foodLogId` in the response
5. Run verifier (expect pass)

### Task 10: Update session validation across all route handlers
**Linear Issue:** [FOO-121](https://linear.app/lw-claude/issue/FOO-121)

1. Update `src/app/api/auth/session/route.ts`:
   - Use new `getSession()` that reads from DB
   - Response should include whether Fitbit is connected (query `getFitbitTokens(email)`)
2. Update `src/app/api/analyze-food/route.ts`:
   - Use new session with `requireFitbit` check querying DB for tokens
3. Update `src/app/app/page.tsx`:
   - Use new `getSession()` to read email from DB-backed session
4. Update `src/app/page.tsx` (landing page):
   - Check session via new `getSession()`
5. Run verifier (expect pass for each file)

### Task 11: Update DEVELOPMENT.md with Docker Postgres setup
**Linear Issue:** [FOO-122](https://linear.app/lw-claude/issue/FOO-122)

1. Add "Database (PostgreSQL)" section to DEVELOPMENT.md Prerequisites:
   - Docker (via Docker Desktop or OrbStack)
2. Add new step between "Install" and "Environment Variables":
   - Step 2: Start Database
   - `docker compose up -d` to start Postgres
   - `docker compose down` to stop
   - `docker compose down -v` to stop and delete data
3. Update `.env.local` template to include `DATABASE_URL`
4. Add note: migrations run automatically on `npm run dev` startup
5. Add "Database Commands" to Available Commands table:
   - `docker compose up -d` — Start local Postgres
   - `docker compose down` — Stop local Postgres
   - `npx drizzle-kit generate` — Generate migration from schema changes
   - `npx drizzle-kit studio` — Open Drizzle Studio (DB browser)
6. Run verifier (expect pass)

### Task 12: Update CLAUDE.md with database conventions
**Linear Issue:** [FOO-123](https://linear.app/lw-claude/issue/FOO-123)

1. Update Tech Stack table to include PostgreSQL + Drizzle ORM
2. Update STRUCTURE section to include:
   - `src/db/` — Database schema, connection, and migration runner
   - `src/db/schema.ts` — Drizzle schema (source of truth for DB tables)
   - `src/db/index.ts` — Singleton DB connection
   - `src/db/migrate.ts` — Migration runner (called at startup)
   - `drizzle/` — Generated SQL migration files
   - `drizzle.config.ts` — Drizzle Kit configuration
   - `docker-compose.yml` — Local Postgres for development
3. Add "DATABASE" section:
   - ORM: Drizzle ORM with `pg` driver
   - Schema defined in TypeScript (`src/db/schema.ts`)
   - Migrations generated via `npx drizzle-kit generate`, applied at startup via programmatic `migrate()`
   - Connection: singleton via `getDb()` in `src/db/index.ts`
   - Local dev: Docker Compose Postgres
   - Production: Railway Postgres (DATABASE_URL reference variable)
   - Convention: use Drizzle query builder, NOT raw SQL
   - Convention: all DB access through `src/lib/` modules, never import `getDb()` directly in route handlers
4. Update ENVIRONMENT VARIABLES section to include `DATABASE_URL`
5. Update COMMANDS section if any new scripts are added
6. Run verifier (expect pass)

### Task 13: Integration & Verification
**Issues:** All

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Verify migration files exist in `drizzle/` folder
6. Manual verification:
   - [ ] `docker compose up -d` starts Postgres
   - [ ] `npm run dev` runs migrations and starts server
   - [ ] Login flow works (Google OAuth → session in DB)
   - [ ] Fitbit connection stores tokens in DB (not cookie)
   - [ ] Food logging writes to both Fitbit AND food_logs table
   - [ ] Session extends on use (sliding expiration)
   - [ ] Logout deletes session from DB

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Integrate PostgreSQL database via Drizzle ORM for food logging, session management, and Fitbit token storage.

**Request:** Add PostgreSQL with three tables (sessions, fitbit_tokens, food_logs). Move session and token persistence from cookie-only to DB-backed. Log food entries locally. Add sliding session expiration. Set up Docker for local dev. Update DEVELOPMENT.md and CLAUDE.md.

**Linear Issues:** FOO-112, FOO-113, FOO-114, FOO-115, FOO-116, FOO-117, FOO-118, FOO-119, FOO-120, FOO-121, FOO-122, FOO-123

**Approach:** Install Drizzle ORM + pg driver. Define schema in TypeScript. Run migrations at app startup via programmatic `migrate()`. Refactor session.ts to use DB as source of truth while keeping iron-session as cookie transport (cookie shrinks to just sessionId). Extract Fitbit token CRUD to its own module backed by DB. Add `insertFoodLog()` to the log-food route. Add Docker Compose for local Postgres. Sliding session expiration via `touchSession()` debounced to once per hour.

**Scope:**
- Tasks: 13
- Files affected: ~20
- New tests: yes

**Key Decisions:**
- Keep iron-session for cookie transport — cookie only holds `{ sessionId }`, all data lives in DB
- Programmatic `migrate()` at startup (not CLI in start script) — avoids drizzle-kit as production dep
- Sliding expiration debounced to 1 hour — avoids DB write on every request
- Food log DB insert failure is non-fatal — Fitbit is the primary operation, local log is secondary
- `getDb()` singleton pattern — single connection pool shared across all requests
- All DB access through `src/lib/` modules — route handlers never import from `src/db/` directly

**Risks/Considerations:**
- Tests will need DB mocking strategy — mock at the `src/lib/` module level (same pattern as current `getSession()` mocks)
- `ensureFreshToken()` signature changes from accepting session object to accepting email string — breaking change but project policy allows it
- Migration files in `drizzle/` folder must be committed to git — they are the source of truth for DB state
- Docker must be installed for local dev — new prerequisite

---

## Iteration 1

**Implemented:** 2026-02-05

### Tasks Completed This Iteration
- Task 1: Install Drizzle ORM and PostgreSQL driver — installed drizzle-orm, pg, drizzle-kit, @types/pg; created drizzle.config.ts; added DATABASE_URL to required env vars
- Task 2: Define database schema — created src/db/schema.ts with sessions, fitbitTokens, foodLogs tables; wrote schema structure tests
- Task 3: Create database connection module and migration runner — created src/db/index.ts (singleton getDb + closeDb), src/db/migrate.ts (programmatic migrations), wired into instrumentation.ts, generated initial migration
- Task 4: Create docker-compose.yml — postgres:17-alpine bound to localhost:5432
- Task 5 (partial): Refactor session management — created src/lib/session-db.ts with createSession, getSessionById, touchSession, deleteSession; DB functions tested. Remaining: update SessionData type, refactor session.ts to use DB functions, update validateSession

### Tasks Remaining
- Task 5 (continued): Update SessionData type in types/index.ts, refactor session.ts to call session-db functions, update validateSession
- Task 6: Move Fitbit token storage to database
- Task 7: Update OAuth callbacks for DB-backed sessions and tokens
- Task 8: Add sliding session expiration
- Task 9: Add food logging to database
- Task 10: Update session validation across all route handlers
- Task 11: Update DEVELOPMENT.md with Docker Postgres setup
- Task 12: Update CLAUDE.md with database conventions
- Task 13: Integration & Verification

### Files Modified
- `package.json` — Added drizzle-orm, pg, drizzle-kit, @types/pg
- `drizzle.config.ts` — Created Drizzle Kit configuration
- `src/lib/env.ts` — Added DATABASE_URL to required env vars
- `src/db/schema.ts` — Created table definitions (sessions, fitbitTokens, foodLogs)
- `src/db/index.ts` — Created singleton getDb() and closeDb()
- `src/db/migrate.ts` — Created programmatic migration runner
- `src/db/__tests__/schema.test.ts` — Schema structure tests
- `src/db/__tests__/index.test.ts` — getDb singleton tests
- `src/lib/session-db.ts` — DB-backed session CRUD functions
- `src/lib/__tests__/session-db.test.ts` — Session DB function tests
- `src/instrumentation.ts` — Wired migrations at startup, closeDb on shutdown
- `docker-compose.yml` — Created local Postgres dev setup
- `drizzle/0000_cute_mimic.sql` — Initial migration SQL
- `drizzle/meta/` — Drizzle migration metadata
- `src/lib/__tests__/env.test.ts` — Fixed: added DATABASE_URL to test setup
- `src/lib/__tests__/image.test.ts` — Fixed: pre-existing duplicate identifier TS error

### Linear Updates
- FOO-112: Todo → In Progress → Review
- FOO-113: Todo → In Progress → Review
- FOO-114: Todo → In Progress → Review
- FOO-115: Todo → In Progress → Review
- FOO-116: Todo → In Progress (partial — DB functions done, session.ts refactor remaining)

### Pre-commit Verification
- bug-hunter: Found 10 issues (3 HIGH, 7 MEDIUM). Fixed 7 before proceeding: env test DATABASE_URL (Bug 3), pool closeDb (Bug 2), getRequiredEnv in getDb (Bug 5), createSession guard (Bug 7), sanitized error logging (Bug 8), localhost Docker bind (Bug 10), image.test.ts pre-existing TS error. Remaining: Bug 1 (token encryption) and Bug 9 (indexes) deferred to Task 6+ when fitbit_tokens/food_logs are actually used.
- verifier: All 459 tests pass, zero typecheck errors, 2 pre-existing lint warnings (img optimization)

### Review Findings

Files reviewed: 16
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Conventions, Edge Cases

No issues found — all implementations are correct and follow project conventions.

**Details:**
- `drizzle.config.ts` — Correct Drizzle Kit config with schema/output paths
- `src/lib/env.ts` — DATABASE_URL properly added to required vars
- `src/db/schema.ts` — All three tables match agreed schema. `withTimezone: true` on all timestamps, `unique()` on fitbitTokens.email, nullable fields correct
- `src/db/index.ts` — Singleton pattern correct, uses `getRequiredEnv()`, `closeDb()` properly nulls both pool and db
- `src/db/migrate.ts` — Error logging sanitized (message only), re-throws after logging
- `src/db/__tests__/schema.test.ts` — Verifies all column definitions for all three tables
- `src/db/__tests__/index.test.ts` — Properly mocks pg, tests singleton behavior with `vi.resetModules()`
- `src/lib/session-db.ts` — UUID via DB default, expiration check in query, guard on empty insert result
- `src/lib/__tests__/session-db.test.ts` — Covers create, get (exists + not found), touch, delete with proper mocking
- `src/instrumentation.ts` — Migrations at startup, graceful shutdown with `closeDb()`, best-effort catch is appropriate
- `docker-compose.yml` — Localhost-bound (127.0.0.1:5432), named volume for persistence
- `drizzle/0000_cute_mimic.sql` — Migration SQL matches schema exactly, unique constraint present
- `src/lib/__tests__/env.test.ts` — DATABASE_URL properly added to test setup
- `src/lib/__tests__/image.test.ts` — Pre-existing TS error fix (duplicate identifier), file is clean
- `package.json` — Correct dep placement: drizzle-orm + pg in deps, drizzle-kit + @types/pg in devDeps

### Linear Updates
- FOO-112: Review → Merge
- FOO-113: Review → Merge
- FOO-114: Review → Merge
- FOO-115: Review → Merge
- FOO-116: Stays In Progress (partial — DB functions done, session.ts refactor remaining)

<!-- REVIEW COMPLETE -->

### Continuation Status
Point budget reached (~119 points consumed). More tasks remain.
