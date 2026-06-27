# Google Health v4 Cutover — Remediation Plan

> **REMEDIATION STATUS — 2026-06-27** (batch 1, on `main` → staging)
>
> **Fixed & verified in this batch (full test suite green):**
> - **P0-2 / P0-3** — `create`/`batchDelete` now parse the long-running `Operation` envelope: extract the dataPoint id from `response.name`, detect `error.code` (google.rpc.Code), and **fail loudly** on an incomplete async Operation instead of silently storing a null id. (No `operations.get` exists and nutrition is writeonly, so create MUST be synchronous — confirmed required behavior, gated by P0-5.)
> - **P0-4** — removed the invalid `utcOffset` from `CivilDateTime` (schema forbids it; was 400-ing the calories-out read); tests assert the schema-valid shape.
> - **P1-1** graceful missing-age (returns blocked, not 502) · **P1-2** server-side weight `filter` · **P1-3** callback verifies `nutrition.writeonly` granted · **P1-4** `RetryInfo.retryDelay` back-off · **P1-6** token skew 5 min · **P1-8** no retry of non-idempotent creates · **P1-10** PII logged as key-shape only · **P1-11** boot guard blocks `ENABLE_TEST_AUTH` on prod · **P1-12** pino `redact` + hostname-based default-deny dry-run guard · **P1-15** per-request timeout → `HEALTH_TIMEOUT`/504.
> - **P2-1** height sort · **P2-7** encryption-key length validated at boot · **P2-8** debug PII → key-shape · **P2-10** `numReplicas: 1` pinned · **P2-14** retry jitter · **P2-15** Operation-path unit tests added.
>
> **Deferred (documented; recommended as batch 2 — validate against the now-working staging):**
> - **P0-1** OAuth restricted-scope verification + CASA + consent-screen "In production" — **operational (GCP console), user action.** See §3.
> - **P0-5** live write/read smoke test — **operational, needs staging booted + a real linked account.** See §3.
> - **P1-5** revoked-token reconcile + reconnect CTA — touches token lifecycle + UI; validate live.
> - **P1-7** edit-food create-first-then-delete — risky critical-path reorder; writes are dry-run on staging; local DB self-heals; validate live.
> - **P1-9** serve-stale-on-error reads — changes caching/freshness semantics and could mask errors during QA; deliberate trade-off.
> - **P1-13** breaker tier simplification · **P1-14** discovery-doc contract-test harness · remaining low **P2** hardening (P2-2/3/4/5/6/9/11/12/13/16-20).

## 1. Readiness verdict & timeline

**Verdict: NOT READY.** `main`/staging is **not** production-solid for the Fitbit → Google Health cutover today.

**Timeline:** Today is 2026-06-27. The legacy Fitbit Web API is turned down **~Sept 2026 (~2–3 months out)**. Production still runs OLD Fitbit code; this NEW Google Health code has **never executed a single live write/delete against the real API** (staging is `HEALTH_DRY_RUN=true`; the write path is gated behind the still-open FOO-1115 smoke test). The integration is well-engineered structurally — scopes, method paths, NutritionLog field shapes, mealType/nutrient enums, and the AES-256-GCM token store all verify cleanly against the live discovery doc — but it carries a small cluster of **API-contract defects on the exact write/delete/read paths that the cutover depends on**, plus an **operational verification gate with an irreducible multi-week lead time**. Against a fixed external deadline, this is the dangerous combination.

### Top 5 risks (honest, unsoftened)

1. **Restricted-scope OAuth verification + annual CASA security assessment is a hard external gate** (multi-week, $500–$4,500 lead time) and its status is unconfirmed. All Google Health scopes are *restricted*; a third-party-server app (Next.js on Railway) cannot serve real users in a stable "Production" publishing status without it. This blocks the entire cutover and cannot be crammed at the deadline.
2. **`create()` returns a long-running Operation; an async/`done:false` response stores `healthLogId = null` and reports success.** On the core write/edit path this silently orphans, duplicates, or loses the user's permanent Google Health nutrition record, with no polling, retry, or reconciliation — and the post-cutover history is all-null by design (MIGRATIONS.md), making the null path common, not edge.
3. **`batchDelete` returns an Operation that is never inspected** — delete success is inferred from HTTP status alone. A failed/pending delete is logged as "deleted," so `edit-food`'s delete-then-recreate leaves **two** nutrition logs counting toward daily totals (the app's primary purpose) while the DB points at only one.
4. **`dailyRollUp` injects a non-existent `utcOffset` field on `CivilDateTime`** (the schema *explicitly prohibits* any timezone/offset). The activity/total-calories read 400s on the very timezone-aware path it was added to support (FOO-1134), and the **unit tests assert the wrong shape**, so the suite is green while production breaks.
5. **Zero automated tests touch the real v4 wire.** Every request/response is a hand-authored mock that ignores the request body; at least one mock (`utcOffset`) is confirmed wrong. A wire divergence will first surface in production, after Fitbit is gone.

---

## 2. Findings summary by priority & category

| Priority | API-correctness | Resilience | Security | Tests | Architecture | Deprecation/Ops | Total |
|---|---|---|---|---|---|---|---|
| **P0** | 3 | – | – | 1 (live gate) | – | 1 | **5** |
| **P1** | 4 | 5 | 3 | 1 | 1 | 1 | **15** |
| **P2** | 3 | 3 | 3 | 6 | 4 | 1 | **20** |

P0 = launch blockers / data loss / breaks writes or reads. P1 = correctness/security/resilience for production confidence. P2 = hardening, tests, cleanup (most can wait — flagged per item).

---

## 3. P0 — Launch blockers (must close before cutover)

### P0-1 — Complete restricted-scope OAuth verification + CASA assessment; set publishing status to "Production"
- **Priority:** P0 · **Severity:** critical · **Effort:** L (external lead time, start NOW)
- **Fix:** Confirm the production GCP OAuth client status immediately. (1) Set publishing status to **In production** (not "Testing") — this is *required* for restricted scopes **and** eliminates the 7-day refresh-token revocation that would otherwise force weekly re-consent on the unattended logger. (2) Complete OAuth verification + the annual **CASA** security assessment (the app accesses restricted health data through a third-party server). (3) End-to-end test the live consent screen for the owner account before the turndown. Track as a hard release gate.
- **Files / artifacts:** `src/lib/auth.ts:7-12` (the 4 `googlehealth.*` restricted scopes); `CLAUDE.md` ENVIRONMENTS; `push-to-production` runbook; `MIGRATIONS.md`.
- **Why P0:** Hard external gate with irreducible multi-week lead time against a fixed ~Sept-2026 deadline. Folds in the "Testing-status 7-day refresh-token expiry" risk (same root config). Single-user allowlist means the 100-user cap is *not* the blocker — the verification/publishing status is.

### P0-2 — `createNutritionLog`: handle the long-running Operation; never store a null `healthLogId` as success
- **Priority:** P0 · **Severity:** high · **Effort:** M
- **Fix:** On 2xx, parse the response as an `Operation`. If `done === true`, extract the DataPoint name from `response.name` → `healthLogId`. If `done === false`, **poll** `operations/{id}` to completion before returning, or **fail loudly** so the caller never persists a write it cannot reference. If the live API accepts a **client-provided DataPoint id** (confirm in P0-5), set it on the request body so the id is known regardless of sync/async — the most robust fix. Do **not** silently warn-and-return `{ healthLogId: null }`.
- **Files:** `src/lib/google-health.ts:462-479` (`parseCreatedDataPointId`), `:610-680` (`createNutritionLog`); consumers `src/app/api/log-food/route.ts:408,441`, `src/app/api/edit-food/route.ts:199,361,431`, `src/app/api/food-history/[id]/route.ts:84`; tests `src/lib/__tests__/google-health.test.ts:536-570`.
- **Why P0:** Core write path; silent, unrecoverable corruption of the user's permanent Google Health record (orphan on delete, duplicate on edit, silent loss on server-side op failure). Null path becomes the *common* case post-cutover (all historical rows null per MIGRATIONS.md).

### P0-3 — `deleteNutritionLogs`: inspect the `batchDelete` Operation instead of inferring success from HTTP status
- **Priority:** P0 · **Severity:** high · **Effort:** M
- **Fix:** On 2xx, parse the body as an `Operation`. Treat as deleted only when `done === true && !error`. Map `Operation.error.code` (`google.rpc.Code`): **5 NOT_FOUND** → existing not-found/idempotency semantics; **7 PERMISSION_DENIED / 3 INVALID_ARGUMENT / others** → `HEALTH_API_ERROR`/`HEALTH_BAD_REQUEST`. If `done === false`, poll or treat as unconfirmed (do **not** delete the local row / proceed to recreate). Drive NOT_FOUND off `error.code === 5` (the HTTP-404 branch is likely never hit for an accepted LRO); keep the HTTP-404 check only as a gateway fallback.
- **Files:** `src/lib/google-health.ts:695-761` (success path `750-760`, 404 branch `731-748`); callers `src/app/api/edit-food/route.ts:333` (drift branch `337`), `src/app/api/log-food/route.ts:339,454` (cleanup rollback), `src/app/api/food-history/[id]/route.ts:84-111`.
- **Why P0:** A falsely-successful delete yields **duplicate** nutrition logs (both counted in daily totals) plus an **orphan** the user can no longer remove via the app. Directly undermines the edit-food delete-then-recreate compensation and the log-food rollback. Closing this also closes the high-severity "silent delete failure → duplicate + orphan" derivative.

### P0-4 — Remove the invalid `utcOffset` field from `CivilDateTime`; fix the tests that assert it
- **Priority:** P0 · **Severity:** high · **Effort:** S
- **Fix:** Delete the `if (zoneOffset) { result.utcOffset = ... }` assignment so `civilDateTime()` emits only schema-valid `{ date: { year, month, day } }` (optionally `time`). `CivilDateTime` is timezone-agnostic by design; the local civil date range alone correctly scopes the rollup. Keep `zoneOffset` for selecting **which** civil date and for the cache key — never embed it in the object. Update the two assertions to expect `{ date: {...} }` (no `utcOffset`) and add a guard asserting the rollup body contains no `utcOffset` anywhere.
- **Files:** `src/lib/google-health.ts:803-806` (`civilDateTime`), reached from `:1066-1068` (`getHealthActivitySummary`); live path `src/app/api/v1/activity-summary/route.ts:48-59` → `src/lib/health-cache.ts:218`; tests `src/lib/__tests__/google-health.test.ts:1243-1264, 1296-1297`.
- **Why P0:** Confirmed API-contract violation on a live-reachable read; Google's JSON parser rejects unknown body fields (400 INVALID_ARGUMENT → `HEALTH_BAD_REQUEST`), breaking the calories-out read on the exact timezone path FOO-1134 added. Green tests currently certify the broken shape — fix them in lockstep or the code fix gets reverted to satisfy the suite.

### P0-5 — Run the live write/read smoke test as a hard go-live gate (resolve FOO-1115)
- **Priority:** P0 · **Severity:** high (gate) · **Effort:** M (depends on P0-1)
- **Fix:** Against a real owner account, execute: (a) **anonymous** `createNutritionLog` → assert 2xx and capture the actual `Operation` shape (`done` inline vs async; does `response` carry a `/dataPoints/{id}` name; is a client-provided id accepted); (b) `batchDelete` → assert the Operation/NOT-FOUND behavior; (c) `dailyRollUp` with a `zoneOffset`, `getHealthLatestWeightKg`, `getHealthProfile`, `getHealthHeightCm` → assert real response shapes. Use the results to confirm P0-2/P0-3/P0-4 before promotion. If anonymous creates are rejected (the `food` field carries a "Required" marker), switch to the identified-food flow.
- **Files:** `src/lib/google-health.ts:563` (anonymous create), `:606-609` (FOO-1115 comment); `MIGRATIONS.md`.
- **Why P0:** This is the single highest-impact *unverified* assumption: if anonymous creates fail, **every** nutrition write fails. The whole write path is currently validated only by mocks. Make this an explicit gate in `push-to-production`.

---

## 4. P1 — Needed for production confidence

### Correctness / API

- **P1-1 — `getHealthProfile` treats Optional `age` as fatal.** `age` is documented Optional (derived from birth date, updates unsupported). Missing age throws `HEALTH_API_ERROR` → nutrition-goals **502**, bricking the goals/macro feature for a legitimate account state. Fix: degrade gracefully like height/sex — return a typed `blocked: invalid_profile` (infra already exists at `daily-goals.ts:62`, `macro-engine.ts:72-79`) or apply a documented fallback age. Files: `src/lib/google-health.ts:927-935`; `src/lib/daily-goals.ts:489-507`; `src/app/api/nutrition-goals/route.ts:67-69`. Severity medium · Effort S.
- **P1-2 — `getHealthLatestWeightKg` uses client-side filtering + pageSize=100; past-date queries can return null despite a valid sample.** The "filter syntax isn't confirmed" comment is false — the discovery doc documents exact `weight.sample_time.physical_time >= "...Z" AND < "...Z"` (and `civil_time`) syntax. Fix: use the server-side `filter` param (window is already RFC3339); take the first descending result. Removes the 100-cap, future-dated-sample, and past-date-null bugs; delete the stale comment. Files: `src/lib/google-health.ts:962-963,980-1023`; caller `src/lib/daily-goals.ts:359`. Severity medium · Effort M.
- **P1-3 — Connect callback never verifies all 4 restricted scopes were granted (granular consent).** A user can deselect `nutrition.writeonly` and still be redirected to `/app` as "connected"; first write 403s. Fix: after exchange, compute `missing = GOOGLE_HEALTH_SCOPES − grantedSet`; if any required scope (min: nutrition.writeonly) is absent, redirect to a re-consent page, don't report success. Files: `src/app/api/auth/google/callback/route.ts:120-141`; reuse `src/lib/health-connection.ts`. Severity medium · Effort S.
- **P1-4 — Breaker never reads `google.rpc.RetryInfo.retryDelay` from the error body.** Only the `Retry-After` header is parsed, which Google likely never sends; the in-line 429 retry then sleeps just 1s (inside the same per-minute window) and re-hits 429, while cooldown blindly defaults to 60s. Fix: parse `error.details[]` for `RetryInfo.retryDelay` and prefer it; drop/raise the 1s no-header retry. Files: `src/lib/google-health.ts:189,209-219`; `src/lib/google-health-rate-limit.ts:24-41`. Severity medium · Effort M.

### Resilience

- **P1-5 — Revoked/dead refresh token is never reconciled; no proactive reconnect.** `checkHealthConnection` is local-DB-only and reports `healthy` for a present-but-dead token; `deleteHealthTokens` has **zero callers** (dead code). Passive dashboard users see a silently broken UI with no reconnect CTA. Fix: on definitive `HEALTH_TOKEN_INVALID` from `ensureFreshToken`/`refreshGoogleHealthToken` (400/401), call `deleteHealthTokens(userId)` (or set a `revoked` flag) so the banner flips to `needs_reconnect`; add a reconnect CTA on read surfaces (targets/profile cards). Files: `src/lib/health-connection.ts:19-39`; `src/lib/health-tokens.ts:100`; `src/lib/google-health.ts:306,373`; `src/components/health-status-banner.tsx`, `targets-card.tsx`, `health-profile-card.tsx`. Severity medium · Effort M.
- **P1-6 — Token freshness skew (1h) ≥ access-token lifetime (1h) → every Health op refreshes.** A freshly minted 1h token never satisfies "expires >1h from now," so the fast-return branch is dead; each op does a full token round-trip + DB upsert. Fix: set `TOKEN_EXPIRY_SKEW_MS = 300_000` (5 min). Files: `src/lib/google-health.ts:57-58,377,389`. Severity medium · Effort S.
- **P1-7 — `edit-food` deletes the old log *before* creating the replacement; a crash/timeout in the gap loses the meal in Google Health.** Compensation only fires for in-process exceptions. Fix: invert to **create-new-first, then delete-old** (a crash leaves a recoverable duplicate, not loss); optionally persist a pending-compensation marker. Files: `src/app/api/edit-food/route.ts:331-361` (regular), `177-199` (fast). Severity medium · Effort M. *(Local DB row persists as source of truth, and a later edit self-heals via NOT_FOUND drift — but close it before unattended operation.)*
- **P1-8 — Non-idempotent POST creates are blind-retried on 429/5xx with no idempotency key.** A create that committed before a 502/timeout is duplicated on retry; a create that aborts after commit (and returns no id) cannot be compensated in log-food's new-food flow. Fix: don't blind-retry non-idempotent creates — restrict 5xx/429 retry to idempotent methods, or read-back before retrying a create. Files: `src/lib/google-health.ts:182-240,630-641`; `src/app/api/log-food/route.ts:336,451`. Severity medium · Effort M.
- **P1-9 — No serve-stale-on-error for Health reads; macro engine has no last-known-good fallback for today's compute.** When the API *throws* (5xx/timeout/rate-limit/token-invalid) after short TTLs expire, the dashboard targets/profile hard-fail (502/503/504) instead of degrading. Fix: serve last cached value on thrown read errors (stale-while-erroring), and have `doCompute` fall back to the most recent `daily_calorie_goals` row flagged stale rather than throwing transient codes. Consciously trades against CLAUDE.md "freshness preferred" for the cutover window. Files: `src/lib/health-cache.ts:104-232`; `src/lib/daily-goals.ts:356-371,489-507`; `src/app/api/nutrition-goals/route.ts:41-72`. Severity medium · Effort M.

### Security

- **P1-10 — Raw health PII forwarded to Sentry at warn/error.** The pino→Sentry integration (`enableLogs`, levels `warn|error|fatal`) ships full structured fields; recent obs commits log `rawProfile: data` (age/sex), `requestBody: body` (food name + macros), and `rawResponse: parsed`. `beforeSend` does no PII scrubbing. Fix: demote raw-body logging to `debug` (not forwarded) and log only shape/keys (`profileKeys`, `Object.keys(body.nutritionLog)`) at warn/error, **or** add a `beforeSendLog` scrubber + pino `redact`. Files: `src/lib/google-health.ts:649,670,931`; `src/instrumentation.ts:16-28`. Severity medium · Effort S.
- **P1-11 — No production boot-guard against `ENABLE_TEST_AUTH=true`.** `test-login` mints a real session for `test@example.com`, bypassing Google OAuth **and** the `ALLOWED_EMAILS` allowlist; only an unset env var stands in the way during the imminent promotion. Fix: add a boot assertion (sibling to `validateHealthDryRunEnv`) that throws if `ENABLE_TEST_AUTH==="true"` and `APP_URL` is production. Files: `src/app/api/auth/test-login/route.ts:10`; `src/instrumentation.ts:39-41`; `src/lib/env.ts`. Severity medium · Effort S.
- **P1-12 — Pino logger has no `redact` config + dry-run boot guard fails OPEN on unexpected `APP_URL`.** (a) Add `redact` paths (`*.authorization`, `*.accessToken`, `*.refresh_token`, `*.client_secret`, `*.cookie`, etc.) so any future accidental token/cookie log is censored — important now that warn/error leave the process. (b) Make `isHealthDryRun()`/`validateHealthDryRunEnv` **default-deny**: require an explicit `HEALTH_DRY_RUN` on any non-localhost host (URL-parse + exact hostname compare, not `includes()`), so a renamed/misconfigured staging `APP_URL` can't silently enable live writes. Files: `src/lib/logger.ts:15-28`; `src/lib/env.ts:76-95`; `src/lib/google-health.ts:482-483`. Severity medium · Effort S.

### Architecture / tests

- **P1-13 — Criticality tiers `important` and `optional` are runtime-identical; the documented headroom model is not implemented (breaker is purely reactive).** Either implement real per-user headroom accounting (shed `optional` before `important` against the 300/min budget) **or** simplify to critical-vs-noncritical and update the CLAUDE.md rate-limit table so docs stop describing behavior the code lacks. Files: `src/lib/google-health-rate-limit.ts:5-7,128-161`; CLAUDE.md "GOOGLE HEALTH RATE-LIMIT CRITICALITY". Severity medium · Effort M (option A) / S (option B). *Recommend option B at family scale.*
- **P1-14 — Add a contract/schema-validation test harness derived from the discovery doc.** Validate every outbound request body and every mocked response against schemas extracted from the live discovery doc, so hand-authored mocks can no longer drift from the real API (this is *why* the `utcOffset` divergence survived). Pair with a gated, opt-in nightly/pre-release integration test that round-trips create→dailyRollUp→profile/weight reads against a real account. Files: new test harness; `vitest.integration.config.ts`; `.github/workflows/ci.yml`. Severity medium · Effort M.
- **P1-15 — Per-request timeout surfaces as a raw `AbortError` → generic 500, unretried, Sentry noise.** A slow endpoint (likely during cutover) hits the 10s per-request abort long before the 30s deadline; the `AbortError` is mislabeled 500 (not `HEALTH_TIMEOUT`/504), not retried, and emitted as a Sentry error event. Fix: catch the per-request `AbortError` in `fetchWithRetry`, rethrow as `HEALTH_TIMEOUT`, optionally retry within the deadline budget. Files: `src/lib/google-health.ts:113-131,243-245`; `src/lib/http.ts:7`; `src/lib/health-error-response.ts:10-17`. Severity medium · Effort S.

---

## 5. P2 — Hardening, tests, cleanup

**Most of these can wait until after P0/P1; flagged inline.**

### Correctness / API
- **P2-1 — `getHealthHeightCm` returns first dataPoint without sorting** (relies on a "interval start time" descending guarantee that doesn't cover sample types). Mirror the weight reader: sort by `sampleTime` desc. `google-health.ts:868-884`. Low · S. *Can wait* (server likely orders by sample time in practice).
- **P2-2 — Required `interval` omitted when `timing.time` is null** (latent; DB column is NOT NULL so currently unreachable). Either make `interval` unconditional with a deterministic fallback instant, or tighten `HealthLogTiming.time`/`FoodLogEntryDetail.time` to non-null and delete the `undefined` branch. `google-health.ts:512-518`; `src/types/index.ts`. Low · S. *Can wait.*
- **P2-3 — `checkHealthConnection` treats null stored scope as `healthy` (fail-open).** Google always returns `scope`, so null means a corrupt/legacy row. Return `needs_reconnect` (or probe) and log a warning. `src/lib/health-connection.ts:28`. Low · S. *Can wait.*

### Resilience
- **P2-4 — Compensation re-creates drop the timezone offset.** `getFoodLogEntryDetail` never returns `zoneOffset`, so restored meals use the `...Z` UTC fallback — wrong instant and possibly wrong civil day for non-UTC users. Carry `zoneOffset` through `getFoodLogEntryDetail` → `entryTiming`. `src/app/api/edit-food/route.ts:152`; `src/lib/food-log.ts:597-622`; `src/lib/google-health.ts:512-518`. Medium-ish but narrow · S. *Do alongside P1-7 if touching edit-food.*
- **P2-5 — Idempotency cache offers no concurrent-duplicate protection (TOCTOU, write-on-completion).** Latent today (**no client ever sends `clientToken`** — the branch is currently unreachable). When wired, reserve the key atomically with an in-flight Promise (pattern already exists in `health-cache.ts`/`ensureFreshToken`). `src/app/api/log-food/route.ts:211-225,352-362,467-477`. Low · M. *Can wait until clientToken is actually sent.*
- **P2-6 — Breaker/idempotency/refresh state is per-process in-memory; resets on deploy and provides no cross-replica protection.** Single-instance is the de-facto invariant but unenforced. Persist `cooldownUntil` (e.g. in `health_tokens`) so a restart during an active 429 doesn't immediately re-hammer quota. `src/lib/google-health-rate-limit.ts:10,17`; `src/lib/google-health.ts:336`. Low · M. *Can wait.*

### Security
- **P2-7 — `HEALTH_TOKEN_ENCRYPTION_KEY` length/format never validated.** A short/non-base64 value silently yields a weak key. Assert at boot that the base64-decoded key is exactly 32 bytes and round-trips. `src/lib/token-encryption.ts:46`; `src/lib/env.ts`. Low · S. *Can wait* (cheap; do opportunistically).
- **P2-8 — Raw weight/height/activity bodies logged at `debug`.** Suppressed at prod `info` and never reach Sentry, but a deployed `LOG_LEVEL=debug` would surface biometric PII to stdout. Log shape/keys only. `google-health.ts:880,1016,1106`. Low · S. *Can wait.*
- **P2-9 — No PKCE on the OAuth flow.** Confidential server-side client, so not required, but BCP recommends PKCE as defense-in-depth. `src/lib/auth.ts:28-40,100-145`. Low · M. *Optional; not a launch blocker.*

### Architecture
- **P2-10 — Single-instance assumption is unenforced.** Pin `numReplicas=1` in `railway.json` and assert at boot (`RAILWAY_REPLICA_COUNT>1` → fail/warn) so a one-click scale-up can't silently corrupt idempotency/cooldown/cache state. `src/app/api/log-food/route.ts:35-43`; `railway.json`; `src/instrumentation.ts`. Low · S. *Cheap defense-in-depth; do with P1-11/P1-12 boot work.*
- **P2-11 — 403 `RESOURCE_EXHAUSTED` branch is dead code; the comment is factually wrong** (quota arrives as 429, not 403). Also, a genuine non-quota 403 is always mapped to `HEALTH_SCOPE_MISSING`, misdirecting users when the real cause is API-not-enabled/billing. Fix the comment; inspect `error.status` to distinguish PERMISSION_DENIED. `src/lib/google-health.ts:60-69,159-180`; `rate-limit.ts:44-66`. Low · S. *Can wait.*
- **P2-12 — `getSession()` does a DB read + two AES-GCM decrypts per authenticated request** just to compute connection status. Select only `scope` (skip decrypting ciphertext) or cache status with a short TTL. `src/lib/session.ts:71`; `src/lib/health-tokens.ts:22-52`. Low · S. *Can wait.*
- **P2-13 — `getRateLimitSnapshot` is exported but consumed only by tests.** Either surface `cooldownUntil` as a client back-off signal or make it module-private. `src/lib/google-health-rate-limit.ts:101-111`. Info · S. *Can wait.*
- **P2-14 — 5xx exponential backoff has no jitter** (thundering herd). Add randomized jitter. `src/lib/google-health.ts:224-239`. Info · S. *Can wait.*

### Tests
- **P2-15 — Add unit tests for the async/Operation paths** of `create` (`done:false` and `done:true` with `response.name`) and `batchDelete` (Operation envelope, `done:false`, NOT_FOUND in `error.code=5`). Lock the corrected contracts from P0-2/P0-3. `google-health.test.ts:536-570,725-752`. Medium · M. *Do with P0-2/P0-3.*
- **P2-16 — Pin read behavior under `HEALTH_DRY_RUN`.** Reads are not dry-run gated and untested; decide and assert whether profile/weight/activity execute or short-circuit on staging. `google-health.ts:898-1074`; new tests. Medium · S. *Can wait.*
- **P2-17 — Weight read ignores `nextPageToken`/ordering** — add tests for >100 points and newest-after-page-boundary (mooted if P1-2 server-side filter lands; otherwise paginate). `google-health.ts:980-1023`. Low · S. *Fold into P1-2.*
- **P2-18 — Add missing branch tests:** `refreshGoogleHealthToken` malformed-2xx (missing `access_token`/`expires_in`); `parseRetryAfter` HTTP-date form; `fetchWithRetry` 5xx-then-200 and 5xx-past-MAX_RETRIES terminal-return. `google-health.ts:75-88,224-240,311-317`. Low · S. *Can wait.*
- **P2-19 — Document staging QA limitations:** under `HEALTH_DRY_RUN`, writes no-op but profile/weight/activity reads stay LIVE against the tester's real Google account, so daily-goals scenarios can't be DB-seeded deterministically. Document in the `staging-qa` skill; optionally add a `HEALTH_READ_FIXTURES` stub. `google-health.ts:620-625`; `staging-qa` skill. Low · S. *Can wait.*
- **P2-20 — No-action notes (info, for the record):** `batchDelete` 10000-`names` cap needs chunking only if a bulk caller is ever added (`google-health.ts:717-726`); Profile carries **no sex/gender** in v4 — `parseSex(data.sex)` is permanently dead/defensive (keep the NA default; treat `sex_unset` as the normal case, `google-health.ts:828-834,939`); `ensureFreshToken` in-flight dedup comment overstates a cross-instance guarantee it doesn't provide — scope the comment to single-process (`google-health.ts:332-431`).

---

## 6. Appendix — Verified API ground truth (what the live v4 discovery doc actually requires)

All verified independently against `https://health.googleapis.com/$discovery/rest?version=v4` (downloaded raw, ~265 KB, parsed directly — the WebFetch summarizer was unreliable and hallucinated field names, so raw JSON was authoritative).

**Nutrition WRITE — `create`**
- Method `health.users.dataTypes.dataPoints.create`: `POST v4/{+parent}/dataPoints`, request `DataPoint`, **response `Operation`** (long-running; server assigns id; NOT PATCH-by-client-id). Data-type id is `nutrition-log`.
- `DataPoint`: no property is `Required`; code sends `{ nutritionLog: {...} }` — correct.
- `NutritionLog`: `foodDisplayName` (string); `energy`/`energyFromFat` → `EnergyQuantity.kcal` (**kilocalories**, no kJ conversion); `totalCarbohydrate`/`totalFat` → `WeightQuantity.grams`; `serving` → `{ amount, foodMeasurementUnit }` (free-form string); `nutrients[]` → `{ nutrient(enum), quantity.grams }`; `interval` → `SessionTimeInterval` (**Required**, all 4 sub-fields `startTime`/`endTime`/`startUtcOffset`/`endUtcOffset` Required); `mealType` (Optional enum). `food` carries a "Required" marker but the schema prose sanctions an **anonymous** path (`foodDisplayName` + manual nutrients/energy; anonymous logs "not editable").
- **`mealType` enum (full):** `MEAL_TYPE_UNSPECIFIED, BEFORE_BREAKFAST, BREAKFAST, BEFORE_LUNCH, LUNCH, BEFORE_DINNER, DINNER, AFTER_DINNER, SNACK, ANYTIME`. `BEFORE_LUNCH` = "morning snack", `BEFORE_DINNER` = "afternoon snack", `ANYTIME` = "legacy NA". The code's `mapMealType` is **correct** — no finding.
- **`Nutrient` enum** includes `PROTEIN, DIETARY_FIBER, SODIUM, SATURATED_FAT, TRANS_FAT, SUGAR` (singular SUGAR) — all six the code sends are valid; sodium mg→g (`/1000`) correct.

**Nutrition DELETE — `batchDelete`**
- `POST v4/{+parent}/dataPoints:batchDelete`, request `BatchDeleteDataPointsRequest { names: string[] }` (max 10000, Required), **response `Operation`**. Authorized by `nutrition.writeonly` (no separate delete scope). Resource name format: `users/{user}/dataTypes/nutrition-log/dataPoints/{data_point}`. **Failures/NOT_FOUND surface inside `Operation.error` (Status, `code` = `google.rpc.Code`, NOT_FOUND=5) with HTTP 200** — not as an HTTP 404. No `BatchDeleteDataPointsResponse` schema (success `response` is Empty).

**`Operation` envelope:** `{ name: "operations/{id}", done, response, error: Status, metadata }`. `done:false` ⇒ still in progress, no `response`/no DataPoint name yet.

**READS — Profile / Weight / Height**
- `Profile` (method `getProfile`, `GET v4/users/me/profile`, scope `profile.readonly`): complete property set is `age, name, membershipStartDate, *StrideLengthMm`. **`age` is `Optional`** ("based on the user's birth date. Updates to this field are currently not supported."). **No `sex`, no `gender`, no `height`, no `dateOfBirth`** anywhere in the doc.
- `Weight`: `{ weightGrams (double, Required), sampleTime: ObservationSampleTime, notes }`; scope `health_metrics_and_measurements.readonly`. kg = grams/1000.
- `Height`: own data type; `{ heightMillimeters (int64 **string**, Required), sampleTime }`; cm = mm/10.
- `ObservationSampleTime`: `{ physicalTime (RFC3339, Required), utcOffset, civilTime(readOnly) }`.
- `list` (`GET v4/{+parent}/dataPoints`): `pageSize` (default 1440, max 10000), `pageToken`, **documented `filter`** (e.g. `weight.sample_time.physical_time >= "2023-11-24T00:00:00Z" AND ... < "..."`, and `...civil_time >= "2023-11-24"`); response `{ dataPoints, nextPageToken }`, **ordered by interval start time descending**.

**READS — total-calories `dailyRollUp`**
- `POST v4/{+parent}/dataPoints:dailyRollUp` on data type **`total-calories`** (total expenditure incl. basal — the right Fitbit `caloriesOut` analogue). Request `DailyRollUpDataPointsRequest { range: CivilTimeInterval (Required, closed-open, max 14 days), windowSizeDays (default 1), pageSize, pageToken }`. Response `{ rollupDataPoints: [DailyRollupDataPoint] }`; `DailyRollupDataPoint.totalCalories.kcalSum` (double, **kcal**). Note: `ActiveEnergyBurnedRollupValue` and `EnergyQuantityRollup` *also* define `kcalSum`, so reading the `totalCalories` leaf explicitly (not first-match) is required and correct.
- **`CivilDateTime` has EXACTLY `{ date, time }`** — schema description: "ensures that neither the timezone nor the UTC offset can be set to avoid confusion between civil and physical time queries." **No `utcOffset`.** (`utcOffset` exists only on `ObservationSampleTime`, `DateTime`, `HeartBeat`, `Settings` — never `CivilDateTime`.) Scope: `activity_and_fitness.readonly` satisfies the read.

**OAuth / Identity**
- All 4 `googlehealth.*` scopes in `auth.ts:7-12` exist verbatim in `auth.oauth2.scopes` (3 readonly + 1 writeonly; least-privilege, no over-grant). Nutrition is **writeonly** ⇒ the app cannot read back its own nutrition logs (so create-id verification must come from the Operation, not a read-back).
- `getIdentity` (`GET v4/users/me/identity`) → `Identity { name, healthUserId, legacyUserId }`. Code reads `healthUserId` — correct.
- All Google Health scopes are **restricted** ⇒ OAuth verification + annual **CASA** assessment required for a third-party-server app; "Testing" publishing status revokes refresh tokens after **7 days** for these (non-basic) scopes.

**Rate limits:** per-user 300/min, per-project 120k/min, 86.4M/day. Quota exhaustion returns **429** (not 403). Suggested wait is conveyed via `google.rpc.RetryInfo.retryDelay` in `error.details[]` (body), not necessarily a `Retry-After` header.

---

## 7. What was checked and refuted (rigor note)

- **Code comments claiming "verified against v4 discovery doc" were NOT trusted** — every API claim was re-checked against the raw live discovery JSON. The WRITE-path comments happened to be accurate; the `utcOffset` and "filter syntax isn't confirmed" comments were proven **wrong** by the doc.
- **Refuted: the WRITE envelope is broken.** It is not — method path, `nutrition-log` id, `EnergyQuantity.kcal` (kcal, no kJ), `WeightQuantity.grams`, the full `mealType` mapping, all six `Nutrient` enum members, sodium mg→g, `Serving`, and `SessionTimeInterval` shape all match the discovery doc. The mealType prompt-hint (NutritionLog vs BloodGlucose enums) was checked and the code is correct. No finding.
- **Refuted: token transport leaks secrets.** Access/refresh tokens, `Authorization` headers, cookies, and API keys are **not** logged anywhere; they live only in fetch headers. The obs commits leak *food/profile PII* (P1-10), not credentials. AES-256-GCM token-at-rest crypto (12-byte IV, 16-byte tag, version byte, HKDF-SHA256) is sound; decrypt-failure forces re-auth.
- **Refuted: `Profile` exposes sex/height.** It does not (full property list confirmed: age + stride lengths + name + membership date). The code's `sex→NA` default and separate height data type are correct by design; `parseSex(data.sex)` is permanently dead but harmless.
- **Severity was de-escalated where the doc didn't support the claim.** The "404 idempotency path is dead code" thesis (originally high) was downgraded to medium because the doc fixes only the response *type* (`Operation`), not the HTTP status on not-found — a synchronously-completed LRO may still map NOT_FOUND to HTTP 404. The "Testing-status 7-day expiry," "single-instance corruption," "in-memory breaker," "idempotency TOCTOU," and "ENABLE_TEST_AUTH" findings were de-escalated to medium/low because they are operational/config or latent (e.g. **no client currently sends `clientToken`**, Railway defaults to 1 replica) rather than active code-vs-API divergences.
- **Highest-value class isolated.** Genuine code-vs-real-API divergences (P0-2/P0-3/P0-4, P1-1/P1-2) were separated from test-fidelity and operational gaps so the remediation effort lands first on the defects that silently corrupt or break live data. **No findings were refuted as false** — the only adjustments were severity calibration and de-duplication of the same root issue reported by multiple reviewers.
