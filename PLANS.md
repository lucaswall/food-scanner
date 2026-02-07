# Implementation Plan

**Created:** 2026-02-07
**Source:** Inline request: Pass to production — dual environment setup, dry-run mode, MCP credential isolation, documentation production status update

## Context Gathered

### Codebase Analysis
- **`src/app/api/log-food/route.ts`** — Main food logging route, calls `findOrCreateFood` + `logFood` + `insertCustomFood` + `insertFoodLogEntry`. Two flows: new food and reuse food.
- **`src/app/api/food-history/[id]/route.ts`** — Delete route, calls `deleteFoodLog` (Fitbit) then `deleteFoodLogEntry` (DB). Checks `entry.fitbitLogId` before calling Fitbit API.
- **`mcp-fitbit/auth.ts`** — MCP reads `FITBIT_CLIENT_ID`/`FITBIT_CLIENT_SECRET` from `process.env` (lines 34-35). Collides with food-scanner app credentials.
- **`src/db/schema.ts`** — `fitbitLogId` is `bigint("fitbit_log_id", { mode: "number" })` and nullable. For dry-run, store `null` (no schema change needed).
- **`src/types/index.ts`** — `FoodLogResponse.fitbitLogId` typed as `number`. Needs to become optional for dry-run.
- **`CLAUDE.md`** — Status says "DEVELOPMENT", development policies say "Breaking changes OK".
- **`README.md`** — No mention of environments or staging. Single Railway deployment.
- **`DEVELOPMENT.md`** — Status says "active development", "Breaking changes are expected".

### MCP Context
- **Railway:** Current setup has 2 services (Postgres + food-scanner) in single production environment. User has configured staging environment manually.
- **Linear:** "Food Scanner" team active, all previous issues resolved.

## Original Plan

### Task 1: Add FITBIT_DRY_RUN support to log-food route
**Linear Issue:** [FOO-206](https://linear.app/lw-claude/issue/FOO-206)

1. Write tests in `src/app/api/log-food/__tests__/route.test.ts` for dry-run mode:
   - Test: when `FITBIT_DRY_RUN=true`, `findOrCreateFood` and `logFood` are NOT called
   - Test: when `FITBIT_DRY_RUN=true`, response still returns success with `fitbitLogId: null`
   - Test: when `FITBIT_DRY_RUN=true`, `insertCustomFood` and `insertFoodLogEntry` are still called (DB logging works)
   - Test: when `FITBIT_DRY_RUN=true`, `insertFoodLogEntry` receives `fitbitLogId: null`
   - Test: when `FITBIT_DRY_RUN=true`, reuse flow also skips Fitbit API but still inserts log entry
   - Test: when `FITBIT_DRY_RUN` is not set, normal Fitbit flow executes (existing tests cover this)
2. Run verifier (expect fail)
3. Implement dry-run logic in `src/app/api/log-food/route.ts`:
   - Read `process.env.FITBIT_DRY_RUN` at the top of the POST handler
   - When `"true"`: skip `ensureFreshToken`, `findOrCreateFood`, `logFood` calls
   - For new food flow: still call `insertCustomFood` (with `fitbitFoodId: null`) and `insertFoodLogEntry` (with `fitbitLogId: null`)
   - For reuse flow: still call `insertFoodLogEntry` (with `fitbitLogId: null`)
   - Return `FoodLogResponse` with `fitbitLogId` as undefined and `dryRun: true`
   - Log at INFO: `"food logged in dry-run mode (Fitbit API skipped)"`
4. Update `src/types/index.ts`:
   - Make `FoodLogResponse.fitbitLogId` optional (`fitbitLogId?: number`)
   - Add `dryRun?: boolean` field
5. Run verifier (expect pass)

### Task 2: Add FITBIT_DRY_RUN support to food-history delete route
**Linear Issue:** [FOO-207](https://linear.app/lw-claude/issue/FOO-207)

1. Write tests in `src/app/api/food-history/[id]/__tests__/route.test.ts`:
   - Test: when `FITBIT_DRY_RUN=true` and entry has `fitbitLogId`, Fitbit delete is still skipped
   - Test: when `FITBIT_DRY_RUN=true` and entry has null `fitbitLogId`, DB delete proceeds normally
   - Test: when `FITBIT_DRY_RUN` is not set, existing Fitbit delete behavior works
2. Run verifier (expect fail — test file may not exist yet)
3. Implement dry-run logic in `src/app/api/food-history/[id]/route.ts`:
   - Read `process.env.FITBIT_DRY_RUN`
   - When `"true"`: skip `ensureFreshToken` and `deleteFoodLog` calls entirely
   - Always proceed with `deleteFoodLogEntry` (local DB delete)
   - Log at INFO: `"food log entry deleted in dry-run mode (Fitbit API skipped)"`
4. Run verifier (expect pass)

### Task 3: Rename MCP Fitbit env vars to avoid collision
**Linear Issue:** [FOO-208](https://linear.app/lw-claude/issue/FOO-208)

1. No TDD needed — this is a config change in the MCP (outside Next.js app)
2. Edit `mcp-fitbit/auth.ts`:
   - Line 34: change `process.env.FITBIT_CLIENT_ID` to `process.env.MCP_FITBIT_CLIENT_ID`
   - Line 35: change `process.env.FITBIT_CLIENT_SECRET` to `process.env.MCP_FITBIT_CLIENT_SECRET`
   - Line 37-38: update error message to reference `MCP_FITBIT_CLIENT_ID` and `MCP_FITBIT_CLIENT_SECRET`
3. Verify the change doesn't affect the Next.js app (MCP is a separate process)

### Task 4: Update CLAUDE.md for production status
**Linear Issue:** [FOO-209](https://linear.app/lw-claude/issue/FOO-209)

1. Update `## STATUS` section:
   - Change from `## STATUS: DEVELOPMENT` to `## STATUS: PRODUCTION`
   - Replace breaking changes policy with production-appropriate wording
2. Update `## DEVELOPMENT POLICIES` section:
   - Remove: "Breaking changes OK — No backward compatibility required"
   - Remove: "Delete unused code immediately — No deprecation warnings"
   - Remove: "No 'for compatibility' code — When changing APIs, update ALL references"
   - Add: "Migration-aware changes — When a change requires data migration (DB schema, session format, token format, etc.), document what existing data is affected and how it will be migrated. Inform the user in the commit/PR — no approval needed, just transparency."
   - Keep: "Delete unused code immediately" (still fine — no deprecation ceremony needed)
3. Update `## ENVIRONMENT VARIABLES` section:
   - Add `FITBIT_DRY_RUN` with description (optional, staging-only)
   - Add note about MCP env vars: `MCP_FITBIT_CLIENT_ID` and `MCP_FITBIT_CLIENT_SECRET` (set in shell, not in Railway)
4. Update `## DEPLOYMENT` or add new section `## ENVIRONMENTS`:
   - Document dual-environment setup: `main` → staging, `release` → production
   - Document staging URL
   - Document promotion flow: merge `main` → `release`

### Task 5: Update README.md for production status
**Linear Issue:** [FOO-210](https://linear.app/lw-claude/issue/FOO-210)

1. Update deployment section to reflect dual environments:
   - Production: `food.lucaswall.me` (deploys from `release` branch)
   - Staging: staging URL (deploys from `main` branch)
2. Add "Environments" section explaining:
   - Branch strategy: `main` → staging, `release` → production
   - Each environment has its own Postgres, variables, domain
   - Staging uses `FITBIT_DRY_RUN=true`
   - Promotion: merge `main` → `release` to deploy to production
3. Remove the "Cost Estimates" section entirely
4. Update OAuth Setup sections to mention both environments' redirect URIs

### Task 6: Update DEVELOPMENT.md for production status
**Linear Issue:** [FOO-211](https://linear.app/lw-claude/issue/FOO-211)

1. Update "Development Status" section:
   - Change from "active development, breaking changes expected" to "production"
   - Document migration policy: when changes affect existing data (schema, session format, token format), document the migration path and inform the user — no approval gate, just transparency
2. Add note about `FITBIT_DRY_RUN` in environment variables section
3. Add section about branch workflow:
   - `main` — development branch, deploys to staging
   - `release` — stable branch, deploys to production
   - Feature branches → PR to `main` → merge to `main` (staging auto-deploys) → merge `main` to `release` (production deploys)

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Transition food-scanner to production with dual-environment support (staging + production)

**Request:** Build the pass-to-production plan including FITBIT_DRY_RUN for staging, MCP credential isolation, and documentation updates reflecting production status with breaking-change policies.

**Linear Issues:** [FOO-206](https://linear.app/lw-claude/issue/FOO-206), [FOO-207](https://linear.app/lw-claude/issue/FOO-207), [FOO-208](https://linear.app/lw-claude/issue/FOO-208), [FOO-209](https://linear.app/lw-claude/issue/FOO-209), [FOO-210](https://linear.app/lw-claude/issue/FOO-210), [FOO-211](https://linear.app/lw-claude/issue/FOO-211)

**Approach:** Add `FITBIT_DRY_RUN` env var to skip Fitbit API calls in staging while preserving local DB logging. Rename MCP env vars to prevent OAuth token collisions. Update all documentation to reflect production status, dual-environment setup, and new breaking-change policies.

**Scope:**
- Tasks: 6
- Files affected: ~8 (2 route files, 1 type file, 1 MCP file, 3 doc files, 1-2 test files)
- New tests: yes

**Key Decisions:**
- Dry-run stores `null` for `fitbitLogId` (no schema change, no sentinel strings)
- `FoodLogResponse.fitbitLogId` becomes optional, plus `dryRun?: boolean` flag
- MCP uses `MCP_FITBIT_CLIENT_ID`/`MCP_FITBIT_CLIENT_SECRET` to avoid collision with app's `FITBIT_CLIENT_ID`
- Production status means migration-aware development: document migration path when existing data is affected, inform user (no approval gate)

**Risks/Considerations:**
- Dry-run mode in new food flow: `insertCustomFood` receives `fitbitFoodId: null` — verified the column is nullable, no schema change needed.

---

## Iteration 1

**Implemented:** 2026-02-07
**Method:** Agent team (2 workers) + lead direct tasks

### Tasks Completed This Iteration
- Task 1: Add FITBIT_DRY_RUN support to log-food route (FOO-206) — dry-run mode for new food and reuse flows, type updates (worker-1)
- Task 2: Add FITBIT_DRY_RUN support to food-history delete route (FOO-207) — dry-run mode for delete (worker-2)
- Task 3: Rename MCP Fitbit env vars to avoid collision (FOO-208) — MCP_FITBIT_CLIENT_ID/SECRET (lead)
- Task 4: Update CLAUDE.md for production status (FOO-209) — STATUS: PRODUCTION, ENVIRONMENTS section, env vars (lead)
- Task 5: Update README.md for dual-environment deployment (FOO-210) — Environments section, OAuth URIs, removed Cost Estimates (lead)
- Task 6: Update DEVELOPMENT.md for production status (FOO-211) — production status, branch workflow, FITBIT_DRY_RUN (lead)

### Files Modified
- `src/app/api/log-food/route.ts` — Added FITBIT_DRY_RUN support for both new food and reuse flows
- `src/app/api/log-food/__tests__/route.test.ts` — Added 7 dry-run tests
- `src/types/index.ts` — Made fitbitFoodId and fitbitLogId optional, added dryRun field
- `src/app/api/food-history/[id]/route.ts` — Added FITBIT_DRY_RUN support for delete
- `src/app/api/food-history/[id]/__tests__/route.test.ts` — Created with 12 tests (including 3 dry-run)
- `src/components/food-log-confirmation.tsx` — Fixed UI for dry-run mode (conditional Log ID display)
- `mcp-fitbit/auth.ts` — Renamed env vars to MCP_FITBIT_CLIENT_ID/SECRET
- `CLAUDE.md` — Production status, ENVIRONMENTS section, env vars docs
- `README.md` — Environments section, OAuth URIs for both envs, removed Cost Estimates
- `DEVELOPMENT.md` — Production status, branch workflow section, FITBIT_DRY_RUN docs

### Linear Updates
- FOO-206: Todo → In Progress → Review
- FOO-207: Todo → In Progress → Review
- FOO-208: Todo → In Progress → Review
- FOO-209: Todo → In Progress → Review
- FOO-210: Todo → In Progress → Review
- FOO-211: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 medium bug (UI fitbitLogId display), fixed before committing. 2 low bugs noted as acceptable.
- verifier: All 812 tests pass (66 files), build + lint + typecheck zero warnings

### Work Partition
- Worker 1: Task 1 (log-food route + types)
- Worker 2: Task 2 (food-history delete route)
- Lead: Tasks 3-6 (MCP config + documentation)

### Review Findings

Files reviewed: 10
Reviewers: security, reliability, quality (agent team)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions, Test Quality

Summary: 0 critical, 0 high, 3 medium (documented only — pre-existing patterns or standalone tooling), 5 low

**Documented (no fix needed):**
- [MEDIUM] ERROR: `getFoodLogEntry()` DB call outside try/catch in `src/app/api/food-history/[id]/route.ts:22` — pre-existing pattern, not a regression from this iteration
- [MEDIUM] RESOURCE: Timer not cleared on OAuth success/error in `mcp-fitbit/auth.ts:221-224` — local MCP dev tool, low production impact
- [MEDIUM] TYPE: Unsafe type assertions on Fitbit API response in `mcp-fitbit/auth.ts:83-88,115-120` — local MCP dev tool, low production impact
- [LOW] EDGE CASE: Truthiness check for `reuseCustomFoodId` in `src/app/api/log-food/route.ts:156` — DB IDs start at 1, 0 is impossible
- [LOW] EDGE CASE: `foodName: undefined` in log for reuse flow in `src/app/api/log-food/route.ts:141-148`
- [LOW] CONVENTION: README.md says "Next.js 15+" but CLAUDE.md says "Next.js 16+" — minor version inconsistency
- [LOW] CONVENTION: `console.error` in MCP tool (`mcp-fitbit/auth.ts`) — acceptable for standalone tooling
- [LOW] TYPE: Loose `!= null` in `food-log-confirmation.tsx:57` — intentional and correct for null+undefined check

### Linear Updates
- FOO-206: Review → Merge
- FOO-207: Review → Merge
- FOO-208: Review → Merge
- FOO-209: Review → Merge
- FOO-210: Review → Merge
- FOO-211: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
