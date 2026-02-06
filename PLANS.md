# Fix Plan: Add exponential backoff retry to database migration at startup

**Issue:** [FOO-124](https://linear.app/lw-claude/issue/FOO-124/add-exponential-backoff-retry-to-database-migration-at-startup)
**Date:** 2026-02-06
**Status:** Planning
**Branch:** fix/FOO-124-migration-retry-backoff

## Investigation

### Bug Report
The food-scanner site (food.lucaswall.me) shows an internal server error. Railway deploy logs reveal the Next.js server crash-loops because the database migration fails on startup — DNS resolution for `Postgres.railway.internal` fails with `ENOTFOUND`. The server crashes, Railway restarts it, and it fails again in an infinite loop.

### Classification
- **Type:** Deployment Failure / Reliability
- **Severity:** Critical (production down, site completely unreachable)
- **Affected Area:** `src/db/migrate.ts`, `src/instrumentation.ts`

### Root Cause Analysis
`runMigrations()` in `src/db/migrate.ts` attempts a single database connection with zero retry logic. When Railway's private DNS is not immediately available (which can happen due to service boot ordering, DNS propagation delays, or transient networking issues), the migration fails and the thrown error crashes the Next.js instrumentation hook, taking down the entire server.

Railway's restart policy (`ON_FAILURE`, max 10 retries) restarts the process, but each restart happens too quickly — DNS may still not be available, so it burns through all retries and the service stays down.

#### Evidence
- **File:** `src/db/migrate.ts:5-17` — `runMigrations()` has try/catch but re-throws on any error, no retry
- **File:** `src/instrumentation.ts:15-16` — `await runMigrations()` called with no error handling; thrown error crashes the hook
- **Logs:** Deployment `c871c1fc` shows continuous `ENOTFOUND Postgres.railway.internal` from 02:21 through 02:28+ (7+ min crash loop)
- **Logs:** Postgres service is healthy — `database system is ready to accept connections` at 01:09:10

#### Related Code
```typescript
// src/db/migrate.ts — current (no retry)
export async function runMigrations(): Promise<void> {
  logger.info({ action: "migrations_start" }, "running database migrations");
  try {
    await migrate(getDb(), { migrationsFolder: "./drizzle" });
    logger.info({ action: "migrations_success" }, "database migrations completed");
  } catch (error) {
    logger.error(
      { action: "migrations_failed", error: error instanceof Error ? error.message : String(error) },
      "database migrations failed",
    );
    throw error;
  }
}
```

### Impact
- Site is completely down (500 on every request)
- No workaround — requires code fix and redeploy
- Affects single user (wall.lucas@gmail.com) but blocks all functionality

## Fix Plan (TDD Approach)

### Task 1: Write failing tests for retry behavior
- **File:** `src/db/__tests__/migrate.test.ts` (new file)
- **Tests:**
  1. Test succeeds on first attempt — no retry needed
  2. Test retries on transient failure then succeeds (e.g., fails twice, succeeds third)
  3. Test throws after all retries exhausted (5 attempts)
  4. Test logs each retry attempt with attempt number and delay
  5. Test uses exponential backoff delays (1s, 2s, 4s, 8s, 16s)

```typescript
// Test outline
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: vi.fn(),
}));
vi.mock("@/db/index", () => ({
  getDb: vi.fn(() => ({})),
  closeDb: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("runMigrations", () => {
  it("succeeds on first attempt without retrying");
  it("retries on transient error and succeeds");
  it("throws after exhausting all retries");
  it("logs retry attempts with attempt number and delay");
  it("resets db singleton before retrying to get a fresh connection");
});
```

### Task 2: Implement exponential backoff retry in runMigrations
- **File:** `src/db/migrate.ts`
- **Changes:**
  - Add retry loop with max 5 attempts
  - Exponential backoff: 1s, 2s, 4s, 8s, 16s (base 1s, factor 2x)
  - Call `closeDb()` before each retry to reset the connection pool (the failed pool/connection may be cached in the singleton)
  - Log a warning on each retry with attempt number and next delay
  - Throw original error after all retries exhausted

```typescript
// Implementation outline
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

export async function runMigrations(): Promise<void> {
  logger.info({ action: "migrations_start" }, "running database migrations");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await migrate(getDb(), { migrationsFolder: "./drizzle" });
      logger.info({ action: "migrations_success" }, "database migrations completed");
      return;
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;

      if (isLastAttempt) {
        logger.error(
          { action: "migrations_failed", error: error instanceof Error ? error.message : String(error), attempt },
          "database migrations failed after all retries",
        );
        throw error;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn(
        { action: "migrations_retry", attempt, nextDelay: delay, error: error instanceof Error ? error.message : String(error) },
        `database migration attempt ${attempt} failed, retrying in ${delay}ms`,
      );

      // Reset connection pool — the cached connection may be stale
      await closeDb();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
```

### Task 3: Verify
- [ ] New tests pass
- [ ] Existing tests still pass (`npm test`)
- [ ] TypeScript compiles (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

## Notes
- The `closeDb()` call before retry is important because `getDb()` is a singleton — if the Pool was created with a bad connection, it will keep failing unless we reset it.
- Total max wait before final failure: 1+2+4+8+16 = 31 seconds. This is reasonable for a startup hook.
- The `setTimeout` in the retry loop is fine for instrumentation hooks — they run once at server start, not in request hot paths.
- Railway's restart policy (max 10 retries) provides an outer retry layer, but it's coarse-grained. In-process retry with backoff is more effective for transient DNS issues.

---

## Iteration 1

**Implemented:** 2026-02-06

### Tasks Completed This Iteration
- Task 1: Write failing tests for retry behavior — Created `src/db/__tests__/migrate.test.ts` with 5 tests covering success, retry+succeed, exhaust retries, log verification, and connection pool reset ordering. Used `vi.useFakeTimers()` with `advanceTimersByTimeAsync` for proper timer control.
- Task 2: Implement exponential backoff retry in runMigrations — Added retry loop (5 attempts, 1s/2s/4s/8s/16s backoff), `closeDb()` before each retry to reset stale connection pool, structured warn/error logging with attempt numbers.
- Task 3: Verify — All tests pass, typecheck clean, lint clean, build succeeds.

### Files Modified
- `src/db/migrate.ts` — Added retry loop with exponential backoff, imported `closeDb`
- `src/db/__tests__/migrate.test.ts` — New test file (5 tests)

### Linear Updates
- FOO-124: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 medium test issues (module caching, setTimeout mock), fixed before proceeding. Production code clean.
- verifier: All 466 tests pass, zero warnings. Typecheck, lint, build all clean.

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 2 (`src/db/migrate.ts`, `src/db/__tests__/migrate.test.ts`)
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Edge Cases, Conventions

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- FOO-124: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
