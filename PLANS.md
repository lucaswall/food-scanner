# Implementation Plan

**Created:** 2026-04-10
**Source:** Inline request: Hydration data sync from Health Connect to Food Scanner via Health Helper
**Linear Issues:** [FOO-963](https://linear.app/lw-claude/issue/FOO-963/hydration-readings-schema-types-and-data-access-layer), [FOO-964](https://linear.app/lw-claude/issue/FOO-964/hydration-readings-api-route-post-get-with-tests), [FOO-965](https://linear.app/lw-claude/issue/FOO-965/hydration-readings-apimd-and-claudemd-documentation), [HEA-195](https://linear.app/lw-claude/issue/HEA-195/read-hydration-data-from-health-connect), [HEA-196](https://linear.app/lw-claude/issue/HEA-196/push-hydration-readings-to-food-scanner-sync-integration)
**Branch:** feat/hydration-readings

## Context Gathered

### Codebase Analysis

**Food Scanner — Reference pattern (blood metrics):**
- **Schema:** `src/db/schema.ts:175-216` — `glucoseReadings` and `bloodPressureReadings` tables with `(userId, measuredAt)` composite unique constraint, `zoneOffset` varchar(6), domain-specific fields
- **Types:** `src/types/index.ts:503-546` — `GlucoseReading`/`GlucoseReadingInput` and `BloodPressureReading`/`BloodPressureReadingInput` interface pairs (output has `id`, input omits it)
- **Lib:** `src/lib/health-readings.ts:1-140` — upsert with `onConflictDoUpdate` on composite key, date-range GET with UTC calendar day boundaries (`T00:00:00.000Z` to `T23:59:59.999Z`), `asc(measuredAt)` ordering
- **API route:** `src/app/api/v1/blood-pressure-readings/route.ts:1-172` — POST (batch upsert with per-field validation, MAX_BATCH_SIZE=1000) and GET (single date or from/to range, ETag via `conditionalResponse`). Auth via `validateApiRequest()`, rate limit 60 req/min
- **Tests:** `src/app/api/v1/blood-pressure-readings/__tests__/route.test.ts:1-525` — mocks for api-auth, logger, health-readings, rate-limit. Tests POST (valid, empty, auth, rate limit, missing fields, invalid enums, batch overflow, DB error) and GET (single date, range, empty, missing params, invalid dates, from>to, auth, rate limit, DB error, ETag, 304)
- **API docs:** `API.md` — documents v1 endpoints but blood pressure/glucose not yet added to it
- **No existing hydration/water code** in food-scanner

**Health Helper — Sync infrastructure:**
- **Domain model:** `domain/model/GlucoseReading.kt`, `domain/model/BloodPressureReading.kt` — data classes with validation in `init` block
- **Repository interface:** `domain/repository/BloodGlucoseRepository.kt:6-10` — `writeBloodGlucoseRecord()`, `getLastReading()`, `getReadings(start, end)`
- **HC implementation:** `data/repository/HealthConnectBloodGlucoseRepository.kt` — paginated reads with 120s cumulative / 10s per-page timeout, `DataOrigin` filtering, watermark support
- **Mapper:** `data/repository/BloodGlucoseRecordMapper.kt` — bidirectional mapping between domain model and HC record
- **DTOs:** `data/api/dto/HealthReadingsDtos.kt:1-39` — `GlucoseReadingDto`, `GlucoseReadingRequest`, `BloodPressureReadingDto`, `BloodPressureReadingRequest`, `UpsertResponse`
- **API client:** `data/api/FoodScannerApiClient.kt` — `postGlucoseReadings()`, `postBloodPressureReadings()` with retry on 5xx/429
- **Push repo:** `data/repository/FoodScannerHealthRepositoryImpl.kt` — `pushGlucoseReadings()`, `pushBloodPressureReadings()` with DTO mapping
- **Sync:** `domain/usecase/SyncHealthReadingsUseCase.kt` — generic `syncType()` with watermark, ledger dedup, exponential backoff retry
- **Settings:** `domain/repository/SettingsRepository.kt` — per-type: watermark flow, count, caught-up, run timestamp, direct-push ledger
- **DI:** `di/AppModule.kt:84-94` — `provideBloodPressureRepository()`, `provideBloodGlucoseRepository()` bindings
- **Manifest:** `AndroidManifest.xml:17-21` — READ/WRITE permissions for blood_pressure, blood_glucose, nutrition, plus READ_HEALTH_DATA_HISTORY
- **Tests:** `test/.../HealthConnectBloodGlucoseRepositoryTest.kt` — comprehensive tests for write, getLastReading, getReadings with pagination/timeout/error cases

**Health Connect HydrationRecord (external research):**
- `HydrationRecord` is an `IntervalRecord` (startTime + endTime), not an instant
- Fields: `volume` (Volume class, ml/L/flOz), `startTime`, `endTime`, `startZoneOffset`, `endZoneOffset`, `metadata` (id, dataOrigin, etc.)
- HidrateSpark writes per-drink records; no public API exists
- Permission: `android.permission.health.READ_HYDRATION`
- 30-day historical limit applies (existing watermark pattern handles this)
- No fluid type field in Health Connect

### MCP Context

- **Linear:** Food Scanner team confirmed (ID: `3e498d7a-30d2-4c11-89b3-ed7bd8cb2031`), Health Helper team confirmed (ID: `7b911426-efe2-48cb-93a4-4d69cd4592a6`). No existing hydration-related issues.

## Design Decisions

- **Single `measuredAt` timestamp** mapped from HydrationRecord's `startTime` — endTime discarded (drinks are short intervals)
- **All hydration sources** — no `dataOrigin` filtering in Health Helper; any HC hydration record counts
- **`integer` volume in ml** — whole milliliters sufficient for water tracking
- **API-only** — no UI in Food Scanner; data consumed by external sources via GET endpoint
- **No fluid type field** — Health Connect doesn't provide it; table stores volume + time only

## Tasks

### Task 1: Food Scanner — Schema, types, and data access layer
**Linear Issue:** [FOO-963](https://linear.app/lw-claude/issue/FOO-963/hydration-readings-schema-types-and-data-access-layer)
**Files:**
- `src/db/schema.ts` (modify)
- `src/types/index.ts` (modify)
- `src/lib/health-readings.ts` (modify)

**Steps:**
1. Add `hydrationReadings` table to `src/db/schema.ts` following the `bloodPressureReadings` pattern:
   - `id` serial PK, `userId` uuid FK to users, `measuredAt` timestamp with timezone notNull, `zoneOffset` varchar(6), `volumeMl` integer notNull
   - Composite unique constraint on `(userId, measuredAt)` named `hydration_readings_user_measured_at_uniq`
2. Add `HydrationReading` interface to `src/types/index.ts` (with `id`, `measuredAt`, `zoneOffset`, `volumeMl`) and `HydrationReadingInput` (without `id`). Follow the glucose/BP pattern with `string | null` for optional fields.
3. Add `upsertHydrationReadings(userId, readings)` to `src/lib/health-readings.ts` following the `upsertBloodPressureReadings` pattern — `onConflictDoUpdate` on `(userId, measuredAt)`, update `zoneOffset` and `volumeMl` on conflict.
4. Add `getHydrationReadings(userId, from, to)` to `src/lib/health-readings.ts` following the `getBloodPressureReadings` pattern — UTC calendar day boundaries, `asc(measuredAt)` ordering.
5. Run `npx drizzle-kit generate` to create the migration file. Never hand-write migration files.

**Notes:**
- **Migration note:** New `hydration_readings` table created. No existing production data affected.
- `volumeMl` uses `integer` (not `numeric` like glucose's `valueMgDl`) — no decimal precision needed.

### Task 2: Food Scanner — API route with tests
**Linear Issue:** [FOO-964](https://linear.app/lw-claude/issue/FOO-964/hydration-readings-api-route-post-get-with-tests)
**Files:**
- `src/app/api/v1/hydration-readings/route.ts` (create)
- `src/app/api/v1/hydration-readings/__tests__/route.test.ts` (create)

**Steps:**
1. Write tests in `src/app/api/v1/hydration-readings/__tests__/route.test.ts` following the blood-pressure-readings test file exactly:
   - Same mock setup pattern (api-auth, logger, health-readings, rate-limit)
   - POST tests: valid batch → 200 with upserted count, empty array → 200 with 0, auth 401, rate limit 429, missing `readings` field 400, non-array readings 400, missing `measuredAt` 400, missing `volumeMl` 400, non-positive `volumeMl` 400, non-integer `volumeMl` 400, invalid ISO 8601 `measuredAt` 400, invalid `zoneOffset` format 400, batch exceeds 1000 → 400, DB error → 500, valid with optional `zoneOffset` → 200
   - GET tests: single date → 200, date range → 200, empty result → 200 empty array, missing params → 400, from without to → 400, to without from → 400, invalid date format → 400, from > to → 400, auth 401, rate limit 429, DB error → 500, ETag header present, 304 on If-None-Match match
2. Run verifier (expect fail — route doesn't exist yet)
3. Implement `src/app/api/v1/hydration-readings/route.ts` following the blood-pressure-readings route pattern:
   - POST: `validateApiRequest()` → `checkRateLimit()` (60 req/min, key `v1:hydration-readings:...`) → parse JSON body → validate `readings` array (max 1000) → per-reading validation: `measuredAt` (ISO_8601_RE), `volumeMl` (positive integer), optional `zoneOffset` (ZONE_OFFSET_RE) → call `upsertHydrationReadings()` → `successResponse({ upserted })`
   - GET: `validateApiRequest()` → `checkRateLimit()` → parse `date` or `from`/`to` params → validate with `isValidDateFormat()` → call `getHydrationReadings()` → `conditionalResponse()` with ETag
4. Run verifier (expect pass)

**Notes:**
- Simpler validation than blood pressure — only 3 fields (measuredAt, volumeMl, zoneOffset), no enum values to validate.
- Follow the same import pattern: `validateApiRequest`, `hashForRateLimit` from `@/lib/api-auth`; `successResponse`, `conditionalResponse`, `errorResponse` from `@/lib/api-response`; `createRequestLogger` from `@/lib/logger`; `checkRateLimit` from `@/lib/rate-limit`; `isValidDateFormat` from `@/lib/date-utils`.

### Task 3: Food Scanner — Documentation updates
**Linear Issue:** [FOO-965](https://linear.app/lw-claude/issue/FOO-965/hydration-readings-apimd-and-claudemd-documentation)
**Files:**
- `API.md` (modify)
- `CLAUDE.md` (modify)

**Steps:**
1. Add hydration-readings endpoint documentation to `API.md`:
   - Add `POST /api/v1/hydration-readings` section with request/response schema, validation rules, and error codes
   - Add `GET /api/v1/hydration-readings` section with query parameters (`date` or `from`/`to`), response schema, ETag support
   - Add both endpoints to the Summary table (60/min rate limit, PostgreSQL data source)
   - Also add the blood-pressure-readings and glucose-readings endpoints that are currently missing from API.md (POST+GET for each)
2. Update `CLAUDE.md` DATABASE section: add `hydration_readings` to the tables list.

**Notes:**
- Blood pressure and glucose endpoints were added after API.md was last updated — include them now for completeness.

### Task 4: Health Helper — Read hydration from Health Connect
**Linear Issue:** [HEA-195](https://linear.app/lw-claude/issue/HEA-195/read-hydration-data-from-health-connect)
**Files:**
- `app/src/main/kotlin/com/healthhelper/app/domain/model/HydrationReading.kt` (create)
- `app/src/main/kotlin/com/healthhelper/app/domain/repository/HydrationRepository.kt` (create)
- `app/src/main/kotlin/com/healthhelper/app/data/repository/HealthConnectHydrationRepository.kt` (create)
- `app/src/main/kotlin/com/healthhelper/app/data/repository/HydrationRecordMapper.kt` (create)
- `app/src/main/AndroidManifest.xml` (modify)
- `app/src/test/kotlin/com/healthhelper/app/data/repository/HealthConnectHydrationRepositoryTest.kt` (create)

**Steps:**
1. Create `HydrationReading` domain model with: `volumeMl: Int` (validated > 0 in `init`), `timestamp: Instant`, `zoneOffset: java.time.ZoneOffset?`. Follow `BloodPressureReading.kt` pattern.
2. Create `HydrationRepository` interface following `BloodGlucoseRepository.kt` pattern: `getReadings(start: Instant, end: Instant): List<HydrationReading>`. No `write` or `getLastReading` needed — this is read-only from Health Connect.
3. Create `HydrationRecordMapper.kt` with `mapToHydrationReading(record: HydrationRecord): HydrationReading` — map `record.startTime` to `timestamp`, `record.volume.inMilliliters.toInt()` to `volumeMl`, `record.startZoneOffset` to `zoneOffset`. Follow `BloodGlucoseRecordMapper.kt` pattern. No reverse mapping needed (read-only).
4. Create `HealthConnectHydrationRepository.kt` following `HealthConnectBloodGlucoseRepository.kt`:
   - `getReadings(start, end)` with paginated reads, 120s cumulative / 10s per-page timeout
   - No `DataOrigin` filtering — read all hydration sources
   - No `writeHydrationRecord` — this is read-only
   - No `getLastReading` — not needed for sync-only
5. Write tests in `HealthConnectHydrationRepositoryTest.kt` following the glucose test pattern: null client returns empty, successful reads with mapping, pagination, timeout handling, SecurityException, CancellationException propagation.
6. Add `android.permission.health.READ_HYDRATION` to `AndroidManifest.xml` alongside existing health permissions.
7. Run verifier (health-helper tests)

**Notes:**
- Key difference from glucose/BP: HydrationRecord is an IntervalRecord. Use `startTime` for the timestamp, ignore `endTime`.
- No write capability needed — Health Helper only reads hydration from Health Connect (HidrateSpark writes it).
- No `getLastReading()` — only `getReadings()` for sync watermark-based batch reads.

### Task 5: Health Helper — Push hydration to Food Scanner + sync integration
**Linear Issue:** [HEA-196](https://linear.app/lw-claude/issue/HEA-196/push-hydration-readings-to-food-scanner-sync-integration)
**Files:**
- `app/src/main/kotlin/com/healthhelper/app/data/api/dto/HealthReadingsDtos.kt` (modify)
- `app/src/main/kotlin/com/healthhelper/app/data/api/FoodScannerApiClient.kt` (modify)
- `app/src/main/kotlin/com/healthhelper/app/domain/repository/FoodScannerHealthRepository.kt` (modify)
- `app/src/main/kotlin/com/healthhelper/app/data/repository/FoodScannerHealthRepositoryImpl.kt` (modify)
- `app/src/main/kotlin/com/healthhelper/app/domain/repository/SettingsRepository.kt` (modify)
- `app/src/main/kotlin/com/healthhelper/app/data/repository/DataStoreSettingsRepository.kt` (modify)
- `app/src/main/kotlin/com/healthhelper/app/domain/usecase/SyncHealthReadingsUseCase.kt` (modify)
- `app/src/main/kotlin/com/healthhelper/app/di/AppModule.kt` (modify)

**Steps:**
1. Add `HydrationReadingDto` (measuredAt, volumeMl, zoneOffset) and `HydrationReadingRequest` (readings list) to `HealthReadingsDtos.kt`. Follow `BloodPressureReadingDto` pattern.
2. Add `postHydrationReadings(baseUrl, apiKey, request)` to `FoodScannerApiClient.kt` following `postBloodPressureReadings` pattern — POST to `/api/v1/hydration-readings` with retry on 5xx/429.
3. Add `pushHydrationReadings(readings: List<HydrationReading>): Result<Int>` to `FoodScannerHealthRepository` interface and implementation. Follow `pushBloodPressureReadings` pattern with `toHydrationReadingDto()` mapper.
4. Add hydration sync settings to `SettingsRepository` interface and `DataStoreSettingsRepository`: watermark flow (`lastHydrationSyncTimestampFlow`), count, caught-up flag, run timestamp, direct-push ledger. Follow the glucose/BP pattern exactly.
5. Add hydration `syncType()` call to `SyncHealthReadingsUseCase.invoke()` following the glucose/BP pattern — wire up `hydrationRepository::getReadings`, `foodScannerHealthRepository::pushHydrationReadings`, and all hydration settings flows.
6. Update `pruneDirectPushedTimestamps()` call to include the hydration watermark.
7. Add `provideHydrationRepository()` binding in `AppModule.kt` following `provideBloodGlucoseRepository` pattern — inject `HealthConnectClient?` and `ApplicationContext`, return `HealthConnectHydrationRepository`.
8. Inject `HydrationRepository` into `SyncHealthReadingsUseCase` — update constructor and DI.
9. Run verifier (health-helper tests)

**Notes:**
- The `SyncHealthReadingsUseCase.syncType()` generic function handles all the complexity (watermarks, ledger dedup, retry). Adding hydration is just wiring a new `syncType()` call.
- No single-push method needed (`pushHydrationReading`) — hydration data only syncs via batch, never pushed directly from UI.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes across both projects for consistency
2. Run `verifier` agent — Verify all food-scanner tests pass, lint clean, build clean
3. Run `verifier "e2e"` — NOT required (no UI changes, API-only feature)
4. Verify health-helper builds and tests pass: `cd ../health-helper && ./gradlew test`

---

## Plan Summary

**Objective:** Add hydration data sync pipeline — Health Helper reads from Health Connect, pushes to Food Scanner's new `/api/v1/hydration-readings` endpoint, stored in `hydration_readings` table.
**Linear Issues:** FOO-963, FOO-964, FOO-965, HEA-195, HEA-196
**Approach:** Copy the blood metrics pattern end-to-end. Food Scanner gets a new table, types, lib functions, and API route (POST+GET). Health Helper gets a read-only Health Connect repository for HydrationRecord and sync integration to push data to Food Scanner.
**Scope:** 5 tasks, ~15 files (8 create, 7 modify), ~30 test cases
**Key Decisions:**
- Single `measuredAt` from HydrationRecord.startTime (endTime discarded)
- All hydration sources (no dataOrigin filtering)
- Integer volumeMl (whole milliliters)
- Read-only on Health Helper side (no write to Health Connect)
- No UI — API-only for external consumption
**Risks:**
- Health Connect HydrationRecord granularity from HidrateSpark is unknown — may be per-sip, per-drink, or per-sync. The upsert on `(userId, measuredAt)` handles dedup regardless.
- If two different hydration records from different apps share the exact same startTime, only one will be stored (composite unique constraint). This is acceptable for single-user.

---

## Iteration 1

**Implemented:** 2026-04-10
**Method:** Single-agent

### Tasks Completed This Iteration
- Task 1 (FOO-963): Schema, types, and data access layer — added `hydrationReadings` table, `HydrationReading`/`HydrationReadingInput` types, `upsertHydrationReadings`/`getHydrationReadings` functions, generated migration
- Task 2 (FOO-964): API route (POST + GET) with tests — created `/api/v1/hydration-readings` route with 28 tests (TDD)
- Task 3 (FOO-965): Documentation — added hydration, glucose, and blood pressure endpoints to API.md, updated CLAUDE.md tables list

### Tasks Remaining
- Task 4 (HEA-195): Health Helper — Read hydration from Health Connect (different repo: health-helper)
- Task 5 (HEA-196): Health Helper — Push hydration to Food Scanner + sync integration (different repo: health-helper)

### Files Modified
- `src/db/schema.ts` — Added `hydrationReadings` table
- `src/types/index.ts` — Added `HydrationReading` and `HydrationReadingInput` interfaces
- `src/lib/health-readings.ts` — Added `upsertHydrationReadings` and `getHydrationReadings`
- `src/app/api/v1/hydration-readings/route.ts` — Created POST and GET handlers
- `src/app/api/v1/hydration-readings/__tests__/route.test.ts` — Created 28 test cases
- `drizzle/0019_flowery_medusa.sql` — Generated migration for hydration_readings table
- `API.md` — Added hydration, glucose, and blood pressure endpoint docs + updated summary table
- `CLAUDE.md` — Added `hydration_readings` to tables list
- `MIGRATIONS.md` — Logged new table creation

### Linear Updates
- FOO-963: Todo → In Progress → Review
- FOO-964: Todo → In Progress → Review
- FOO-965: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed — zero bugs found
- verifier: All 3221 tests pass (185 files), zero lint violations, build clean

### Continuation Status
All Food Scanner tasks (1-3) completed. Tasks 4-5 are Health Helper (Kotlin/Android) and must be implemented in the health-helper project.

### Review Findings

Summary: 1 issue found, fixed inline (Team: security, reliability, quality reviewers)
- FIXED INLINE: 1 issue — verified via TDD + bug-hunter

**Issues fixed inline:**
- [MEDIUM] BUG: Semantically invalid ISO 8601 dates (e.g., `2026-99-99T25:61:61Z`) pass regex validation but cause DB error → 500 instead of 400 (`src/app/api/v1/hydration-readings/route.ts:62`) — added `isNaN(new Date().getTime())` check + test

**Discarded findings (not bugs):**
- [DISCARDED] No upper bound on volumeMl — no realistic scenario (no one sends 2B ml); PostgreSQL rejects gracefully
- [DISCARDED] Zone offset semantic validation (+99:99 accepted) — value stored as-is, never parsed; no correctness impact
- [DISCARDED] Unbounded GET date range — pre-existing pattern across all health routes, rate-limited, single-user app; performance concern, not correctness bug
- [DISCARDED] Redundant `as unknown[]` cast after Array.isArray() — pre-existing consistency pattern across all health routes; style-only
- [DISCARDED] Missing `success: false` assertion in 5 GET error tests — error code assertion validates the path; style-only
- [DISCARDED] No test for non-object readings item (e.g., `[null]`) — code handles it correctly; missing coverage for working path is not a bug

### Linear Updates (Review)
- FOO-963: Review → Merge
- FOO-964: Review → Merge
- FOO-965: Review → Merge
- FOO-966: Created in Merge (Fix: semantically invalid ISO 8601 dates — fixed inline)

### Inline Fix Verification
- Unit tests: all 3222 pass (185 files)
- Bug-hunter: no new issues

<!-- REVIEW COMPLETE -->

---

## Iteration 2

**Implemented:** 2026-04-10
**Method:** Single-agent (cross-project, Health Helper)

### Tasks Completed This Iteration
- Task 4 (HEA-195): Health Helper — Read hydration from Health Connect — domain model, repository interface, HC implementation with paginated reads, mapper, tests (8 test cases), AndroidManifest permission
- Task 5 (HEA-196): Health Helper — Push hydration to Food Scanner + sync — DTOs, API client method, push repo, settings (watermark/count/caught-up/run-timestamp), sync use case wiring, DI binding

### Files Modified (Health Helper)
- `app/src/main/kotlin/.../domain/model/HydrationReading.kt` — Created domain model
- `app/src/main/kotlin/.../domain/repository/HydrationRepository.kt` — Created repository interface
- `app/src/main/kotlin/.../data/repository/HydrationRecordMapper.kt` — Created HC→domain mapper
- `app/src/main/kotlin/.../data/repository/HealthConnectHydrationRepository.kt` — Created HC implementation
- `app/src/test/kotlin/.../data/repository/HealthConnectHydrationRepositoryTest.kt` — Created 8 test cases
- `app/src/main/AndroidManifest.xml` — Added READ_HYDRATION permission
- `app/src/main/kotlin/.../data/api/dto/HealthReadingsDtos.kt` — Added HydrationReadingDto/Request
- `app/src/main/kotlin/.../data/api/FoodScannerApiClient.kt` — Added postHydrationReadings()
- `app/src/main/kotlin/.../domain/repository/FoodScannerHealthRepository.kt` — Added pushHydrationReadings()
- `app/src/main/kotlin/.../data/repository/FoodScannerHealthRepositoryImpl.kt` — Implemented pushHydrationReadings()
- `app/src/main/kotlin/.../domain/repository/SettingsRepository.kt` — Added hydration sync settings
- `app/src/main/kotlin/.../data/repository/DataStoreSettingsRepository.kt` — Implemented hydration settings
- `app/src/main/kotlin/.../domain/usecase/SyncHealthReadingsUseCase.kt` — Added hydration syncType() call
- `app/src/main/kotlin/.../di/AppModule.kt` — Added provideHydrationRepository()
- `app/src/test/kotlin/.../domain/usecase/SyncHealthReadingsUseCaseTest.kt` — Updated with hydration mocks

### Linear Updates
- HEA-195: Todo → In Progress → Review
- HEA-196: Todo → In Progress → Review

### Pre-commit Verification
- Health Helper: BUILD SUCCESSFUL, all tests pass

### Continuation Status
All 5 tasks completed across both projects. Plan is complete.

### Review Findings

Summary: 3 issue(s) found (Team: security, reliability, quality reviewers)
- FIX: 3 issue(s) — Linear issues created
- DISCARDED: 3 finding(s) — false positives / not applicable

**Issues requiring fix:**
- [MEDIUM] BUG: `toInt()` truncation in HydrationRecordMapper — sub-1mL values become 0, record silently dropped (`HydrationRecordMapper.kt:8`) (HEA-197)
- [MEDIUM] TEST: Zero hydration sync test coverage in SyncHealthReadingsUseCaseTest — all tests stub hydration to emptyList, never exercise push/watermark/error-isolation (`SyncHealthReadingsUseCaseTest.kt`) (HEA-198)
- [LOW] CONVENTION: Unused `@ApplicationContext context: Context` injection in HealthConnectHydrationRepository — dead code (`HealthConnectHydrationRepository.kt:19-20`) (HEA-199)

**Discarded findings (not bugs):**
- [DISCARDED] Missing multi-page pagination happy path test — pagination logic exercised via timeout path; missing variant is not a bug
- [DISCARDED] Hardcoded Sentry DSN in AndroidManifest.xml — pre-existing, Sentry DSNs are low-risk (event submission only, rate-limited)
- [DISCARDED] Missing WRITE_HYDRATION permission — correct for current read-only design; speculative future concern

### Linear Updates (Review)
- HEA-195: Review → Merge (original task completed)
- HEA-196: Review → Merge (original task completed)
- HEA-197: Created in Todo (Fix: toInt truncation)
- HEA-198: Created in Todo (Fix: missing hydration sync tests)
- HEA-199: Created in Todo (Fix: unused context injection)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration 2
**Linear Issues:** [HEA-197](https://linear.app/lw-claude/issue/HEA-197/fix-hydrationrecordmapper-truncates-fractional-ml-values-instead-of), [HEA-198](https://linear.app/lw-claude/issue/HEA-198/fix-missing-hydration-sync-test-coverage-in), [HEA-199](https://linear.app/lw-claude/issue/HEA-199/fix-remove-unused-context-injection-from)

### Fix 1: HydrationRecordMapper truncates fractional mL values
**Linear Issue:** [HEA-197](https://linear.app/lw-claude/issue/HEA-197/fix-hydrationrecordmapper-truncates-fractional-ml-values-instead-of)

1. Write test in `HealthConnectHydrationRepositoryTest.kt` for fractional volume mapping (e.g., 250.9mL → 251mL, 0.4mL → filtered/dropped)
2. Change `toInt()` to `roundToInt()` in `HydrationRecordMapper.kt:8`
3. Add `coerceAtLeast(1)` or filter sub-0.5mL records before mapping

### Fix 2: Missing hydration sync test coverage
**Linear Issue:** [HEA-198](https://linear.app/lw-claude/issue/HEA-198/fix-missing-hydration-sync-test-coverage-in)

1. Add tests in `SyncHealthReadingsUseCaseTest.kt` following the glucose/BP test patterns:
   - Successful hydration push calls `pushHydrationReadings` and advances watermark
   - Push failure does NOT advance watermark
   - Hydration exception does not block glucose/BP sync (error isolation)
   - caughtUp flag set when < 100 readings returned

### Fix 3: Remove unused Context injection
**Linear Issue:** [HEA-199](https://linear.app/lw-claude/issue/HEA-199/fix-remove-unused-context-injection-from)

1. Remove `@ApplicationContext private val context: Context` from `HealthConnectHydrationRepository.kt` constructor
2. Update `AppModule.kt` DI binding to stop passing context to hydration repository
